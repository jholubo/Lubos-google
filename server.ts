import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createServer as createViteServer } from 'vite';

import {
  prisma,
  formatUser,
  formatCustomer,
  formatFlavor,
  formatOrder,
  formatNotification,
  formatDeliveryZone,
  User,
  Customer,
  Flavor,
  Order,
  Notification,
  DeliveryZone,
} from './server/db.js';

import {
  hashPassword,
  verifyPassword,
  createToken,
  getCurrentUser,
  authMiddleware,
  requireRoles,
  AuthUser,
} from './server/security.js';

import {
  parseCoordsFromUrl,
  pointInPolygon,
  haversineKm,
  calcDeliveryCost,
  roadDistanceKm,
  fetchDirectionsPolyline,
} from './server/geo.js';

import axios from 'axios';

// ── BCV RATE UTILITIES & SCHEDULER (6:00 AM America/Caracas) ──
export async function fetchLiveBcvRate(): Promise<number | null> {
  // Attempt 1: Try direct oficial endpoint
  try {
    console.log('[BCV UPDATE] Fetching live BCV rate from DolarAPI (oficial)...');
    const response = await axios.get('https://ve.dolarapi.com/v1/dolares/oficial', { timeout: 10000 });
    if (response.data) {
      const val = parseFloat(response.data.promedio || response.data.venta || response.data.compra);
      if (val && !isNaN(val) && val > 0) {
        return val;
      }
    }
  } catch (err: any) {
    console.warn('[BCV UPDATE] Failed to fetch from direct oficial endpoint, trying list endpoint...', err.message || err);
  }

  // Attempt 2: Backup - Try list endpoint
  try {
    const response = await axios.get('https://ve.dolarapi.com/v1/dolares', { timeout: 10000 });
    if (Array.isArray(response.data)) {
      const oficialItem = response.data.find((item: any) => 
        item.fuente === 'oficial' || item.nombre?.toLowerCase().includes('oficial') || item.id === 'oficial'
      );
      if (oficialItem) {
        const val = parseFloat(oficialItem.promedio || oficialItem.venta || oficialItem.compra);
        if (val && !isNaN(val) && val > 0) {
          return val;
        }
      }
    }
  } catch (err: any) {
    console.error('[BCV UPDATE] All BCV rate fetch attempts failed:', err.message || err);
  }

  return null;
}

let lastSuccessfulBcvUpdateDay = '';

async function runBcvUpdateScheduler() {
  try {
    const caracasString = new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' });
    const caracasDate = new Date(caracasString);
    const caracasDayStr = `${caracasDate.getFullYear()}-${String(caracasDate.getMonth() + 1).padStart(2, '0')}-${String(caracasDate.getDate()).padStart(2, '0')}`;
    const hour = caracasDate.getHours();

    // If it's 6:00 AM (or later) in Caracas, and we haven't successfully synced for today yet
    if (hour >= 6 && lastSuccessfulBcvUpdateDay !== caracasDayStr) {
      console.log(`[BCV SCHEDULER] Triggering automatic daily update for day ${caracasDayStr} (Caracas time)...`);
      const liveRate = await fetchLiveBcvRate();
      if (liveRate && liveRate > 0) {
        await prisma.appSettings.upsert({
          where: { key: 'app_settings' },
          update: { exchange_rate_ves: liveRate },
          create: { key: 'app_settings', exchange_rate_ves: liveRate, delivery_driver_pct: 85.0 }
        });
        
        lastSuccessfulBcvUpdateDay = caracasDayStr;
        console.log(`[BCV SCHEDULER SUCCESS] Auto-updated exchange_rate_ves to ${liveRate} for ${caracasDayStr}`);
        broadcastEvent('settings_changed');
      } else {
        console.warn(`[BCV SCHEDULER RETRY] Failed to fetch live BCV rate at ${hour}:00, will retry on next check.`);
      }
    }
  } catch (err: any) {
    console.error('[BCV SCHEDULER ERROR] Failed in scheduler loop:', err);
  }
}

// Check every 1 minute
setInterval(runBcvUpdateScheduler, 60 * 1000);

const app = express();
const PORT = 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.text({ type: 'text/plain' }));

// Request logger and Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (req.path.startsWith('/api')) {
    console.log(`[API] ${req.method} ${req.path}`);
  }
  next();
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ── REAL-TIME EVENT STREAM (SSE) ──
const sseClients = new Set<Response>();

export function broadcastEvent(event: string, payload: any = {}) {
  const dataString = `data: ${JSON.stringify({ event, payload, timestamp: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(dataString);
    } catch {
      sseClients.delete(client);
    }
  }
}

app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ event: 'connected', timestamp: Date.now() })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

setInterval(() => {
  const ping = `data: ${JSON.stringify({ event: 'ping', timestamp: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(ping);
    } catch {
      sseClients.delete(client);
    }
  }
}, 20000);

async function getDeliveryDriverPct(): Promise<number> {
  try {
    const s = await prisma.appSettings.findUnique({ where: { key: 'app_settings' } });
    if (s && s.delivery_driver_pct != null) {
      return s.delivery_driver_pct;
    }
  } catch (e) {}
  return 85.0;
}

interface AuthRequest extends Request {
  user?: AuthUser;
}

// ── 1. AUTH ROUTES ──

app.get('/api/public/team', async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        photo_data_url: true,
      },
    });
    res.json(users);
  } catch (err: any) {
    console.error('Error in public team route:', err);
    res.status(500).json({ detail: 'Error al obtener miembros del equipo' });
  }
});

app.get('/api/public/maps-key', (req: Request, res: Response) => {
  const key = process.env.GOOGLE_MAPS_KEY || process.env.VITE_GOOGLE_MAPS_KEY || process.env.GOOGLE_MAPS_PLATFORM_KEY || '';
  res.json({ key });
});

app.post('/api/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ detail: 'Username y password requeridos' });
      return;
    }
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ detail: 'Credenciales incorrectas' });
      return;
    }
    const token = createToken(user.id, user.username, user.role, user.name);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        photo_data_url: user.photo_data_url || null,
      },
    });
  } catch (err: any) {
    console.error('Error in login:', err);
    res.status(500).json({ detail: 'Error en el servidor' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const currentUser = req.user!;
    const user = await prisma.user.findUnique({ where: { id: currentUser.user_id } });
    if (!user) {
      res.status(404).json({ detail: 'Usuario no encontrado' });
      return;
    }
    const formatted = formatUser(user);
    const { password_hash, ...dbUser } = formatted;
    res.json(dbUser);
  } catch (err: any) {
    console.error('Error in auth/me:', err);
    res.status(500).json({ detail: 'Error en el servidor' });
  }
});

// ── 2. USER ROUTES ──

app.get('/api/users', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({ orderBy: { created_at: 'asc' } });
    const result = users.map((u) => {
      const formatted = formatUser(u);
      const { password_hash, ...rest } = formatted;
      return rest;
    });
    res.json(result);
  } catch (err: any) {
    console.error('Error getting users:', err);
    res.status(500).json({ detail: 'Error al obtener usuarios' });
  }
});

app.get('/api/users/deliveries', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const deliveries = await prisma.user.findMany({ where: { role: 'delivery' } });
    const result = deliveries.map((u) => {
      const formatted = formatUser(u);
      const { password_hash, ...rest } = formatted;
      return rest;
    });
    res.json(result);
  } catch (err: any) {
    console.error('Error getting deliveries:', err);
    res.status(500).json({ detail: 'Error al obtener repartidores' });
  }
});

app.post('/api/users', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { username, password, name, role, color } = req.body || {};
    if (!username || !password || !name) {
      res.status(400).json({ detail: 'Faltan campos requeridos' });
      return;
    }
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      res.status(400).json({ detail: 'Usuario ya existe' });
      return;
    }
    const newUser = await prisma.user.create({
      data: {
        id: uuidv4(),
        username,
        password_hash: hashPassword(password),
        name,
        role: role || 'vendedor',
        color: color || null,
      },
    });
    const formatted = formatUser(newUser);
    const { password_hash, ...rest } = formatted;
    res.json(rest);
  } catch (err: any) {
    console.error('Error creating user:', err);
    res.status(500).json({ detail: 'Error al crear usuario' });
  }
});

app.put('/api/users/:user_id', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const existing = await prisma.user.findUnique({ where: { id: user_id } });
    if (!existing) {
      res.status(404).json({ detail: 'Usuario no encontrado' });
      return;
    }
    const { name, role, username, password, photo_data_url, color } = req.body || {};
    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (role !== undefined) updateData.role = role;
    if (username !== undefined) {
      const checkUsername = await prisma.user.findFirst({
        where: { username, NOT: { id: user_id } },
      });
      if (checkUsername) {
        res.status(400).json({ detail: 'Usuario ya existe' });
        return;
      }
      updateData.username = username;
    }
    if (password) {
      updateData.password_hash = hashPassword(password);
    }
    if (photo_data_url !== undefined) {
      updateData.photo_data_url = photo_data_url || null;
    }
    if (color !== undefined) {
      updateData.color = color || null;
    }

    const updated = await prisma.user.update({
      where: { id: user_id },
      data: updateData,
    });

    const formatted = formatUser(updated);
    const { password_hash, ...rest } = formatted;
    res.json(rest);
  } catch (err: any) {
    console.error('Error updating user:', err);
    res.status(500).json({ detail: 'Error al actualizar usuario' });
  }
});

app.delete('/api/users/:user_id', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { user_id } = req.params;
    const existing = await prisma.user.findUnique({ where: { id: user_id } });
    if (!existing) {
      res.status(404).json({ detail: 'Usuario no encontrado' });
      return;
    }
    await prisma.user.delete({ where: { id: user_id } });
    res.json({ message: 'Usuario eliminado' });
  } catch (err: any) {
    console.error('Error deleting user:', err);
    res.status(500).json({ detail: 'Error al eliminar usuario' });
  }
});

// ── 3. CUSTOMER ROUTES ──

function normalizeText(s: string): string {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

app.get('/api/customers', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    let limit = parseInt((req.query.limit as string) || '50', 10);
    limit = Math.max(1, Math.min(limit, 100));

    const allCustomers = await prisma.customer.findMany();

    const deliveredOrders = await prisma.order.findMany({
      where: { status: { not: 'cancelado' }, is_quote: false },
      select: { customer_id: true, customer_phone: true },
    });

    const phoneMap = new Map<string, string>();
    allCustomers.forEach((c) => {
      const pDigits = (c.phone || '').replace(/[^0-9]/g, '');
      if (pDigits.length >= 7) {
        phoneMap.set(pDigits.slice(-10), c.id);
      }
    });

    const countsMap = new Map<string, number>();
    deliveredOrders.forEach((o) => {
      let cId = o.customer_id;
      if (!cId && o.customer_phone) {
        const oDigits = o.customer_phone.replace(/[^0-9]/g, '');
        if (oDigits.length >= 7) cId = phoneMap.get(oDigits.slice(-10)) || null;
      }
      if (cId) {
        countsMap.set(cId, (countsMap.get(cId) || 0) + 1);
      }
    });

    let list = allCustomers.map((c) => ({
      ...formatCustomer(c),
      order_count: countsMap.get(c.id) || 0,
    }));

    if (q) {
      const qNormalized = normalizeText(q).trim();
      const tokens = qNormalized.split(/\s+/).filter(Boolean);
      const digits = q.replace(/[^0-9]/g, '');

      list = list.filter((c) => {
        const nameNorm = normalizeText(c.name);
        const phoneNorm = normalizeText(c.phone || '');
        const phoneDigits = (c.phone || '').replace(/[^0-9]/g, '');

        const matchesTokens = tokens.length > 0 && tokens.every(
          (tok) => nameNorm.includes(tok) || phoneNorm.includes(tok)
        );
        const matchesDigits = !!(digits && phoneDigits.includes(digits));

        return matchesTokens || matchesDigits;
      });
    }

    // Sort by order_count desc (most delivered orders to least), then created_at desc
    list.sort((a, b) => (b.order_count - a.order_count) || (new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()));

    const out = list.slice(0, limit);

    res.json(out);
  } catch (err: any) {
    console.error('Error getting customers:', err);
    res.status(500).json({ detail: 'Error al obtener clientes' });
  }
});

app.post('/api/customers', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { name, phone, gender } = req.body || {};
    if (!name || !phone) {
      res.status(400).json({ detail: 'Nombre y teléfono requeridos' });
      return;
    }
    const norm = phone.replace(/[^0-9]/g, '');
    if (norm) {
      const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true, phone: true } });
      const existing = allCustomers.find((c) => c.phone && c.phone.replace(/[^0-9]/g, '') === norm);
      if (existing) {
        res.status(409).json({ detail: `Ese contacto ya existe como "${existing.name}"` });
        return;
      }
    }
    const newCustomer = await prisma.customer.create({
      data: {
        id: uuidv4(),
        name,
        phone,
        gender: gender || null,
        order_count: 0,
      },
    });
    broadcastEvent('customers_changed');
    res.json(formatCustomer(newCustomer));
  } catch (err: any) {
    console.error('Error creating customer:', err);
    res.status(500).json({ detail: 'Error al crear cliente' });
  }
});

app.put('/api/customers/:customer_id', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { customer_id } = req.params;
    const existing = await prisma.customer.findUnique({ where: { id: customer_id } });
    if (!existing) {
      res.status(404).json({ detail: 'Cliente no encontrado' });
      return;
    }
    const { name, phone, gender } = req.body || {};
    const updated = await prisma.customer.update({
      where: { id: customer_id },
      data: {
        ...(name !== undefined && { name }),
        ...(phone !== undefined && { phone }),
        ...(gender !== undefined && { gender }),
      },
    });

    // Propagate to open orders
    const updateOrdersData: any = {};
    if (name !== undefined) updateOrdersData.customer_name = name;
    if (phone !== undefined) updateOrdersData.customer_phone = phone;
    if (gender !== undefined) updateOrdersData.customer_gender = gender;

    if (Object.keys(updateOrdersData).length > 0) {
      await prisma.order.updateMany({
        where: {
          customer_id,
          status: { in: ['sin_pagar', 'pendiente', 'en_camino', 'cotizacion'] },
        },
        data: updateOrdersData,
      });
    }

    broadcastEvent('customers_changed');
    res.json(formatCustomer(updated));
  } catch (err: any) {
    console.error('Error updating customer:', err);
    res.status(500).json({ detail: 'Error al actualizar cliente' });
  }
});

app.put('/api/customers/bulk-gender', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const customers = req.body?.customers;
    if (!Array.isArray(customers)) {
      res.status(400).json({ detail: 'Formato de clientes inválido' });
      return;
    }

    for (const c of customers) {
      if (c.id) {
        const genderVal = c.gender === 'M' || c.gender === 'F' ? c.gender : null;
        await prisma.customer.update({
          where: { id: c.id },
          data: { gender: genderVal },
        }).catch(() => {});

        await prisma.order.updateMany({
          where: { customer_id: c.id },
          data: { customer_gender: genderVal },
        }).catch(() => {});
      }
    }

    broadcastEvent('customers_changed');
    broadcastEvent('orders_changed');
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Error in bulk customer gender update:', err);
    res.status(500).json({ detail: 'Error al actualizar géneros de clientes' });
  }
});

app.delete('/api/customers/:customer_id', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { customer_id } = req.params;
    const existing = await prisma.customer.findUnique({ where: { id: customer_id } });
    if (!existing) {
      res.status(404).json({ detail: 'Cliente no encontrado' });
      return;
    }
    await prisma.customer.delete({ where: { id: customer_id } });
    await prisma.order.deleteMany({ where: { customer_id } });
    broadcastEvent('customers_changed');
    broadcastEvent('orders_changed');
    res.json({ message: 'Cliente eliminado' });
  } catch (err: any) {
    console.error('Error deleting customer:', err);
    res.status(500).json({ detail: 'Error al eliminar cliente' });
  }
});

app.get('/api/customers/:customer_id/orders', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { customer_id } = req.params;
    const customer = await prisma.customer.findUnique({ where: { id: customer_id } });
    if (!customer) {
      res.status(404).json({ detail: 'Cliente no encontrado' });
      return;
    }

    const normPhone = (customer.phone || '').replace(/[^0-9]/g, '');
    const phoneDigits = normPhone.length >= 7 ? normPhone.slice(-10) : '';

    const OR_conditions: any[] = [{ customer_id }];
    if (phoneDigits) {
      OR_conditions.push({ customer_phone: { contains: phoneDigits } });
    }
    if (customer.name && customer.name.trim()) {
      OR_conditions.push({ customer_name: { equals: customer.name.trim(), mode: 'insensitive' } });
    }

    const orders = await prisma.order.findMany({
      where: {
        OR: OR_conditions,
      },
      include: { items: true },
      orderBy: { created_at: 'desc' },
    });
    res.json(orders.map(formatOrder));
  } catch (err: any) {
    console.error('Error getting customer orders:', err);
    res.status(500).json({ detail: 'Error al obtener pedidos del cliente' });
  }
});

// ── 4. FLAVOR ROUTES ──

app.get('/api/flavors', authMiddleware, async (req: Request, res: Response) => {
  try {
    const list = await prisma.flavor.findMany({
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    res.json(list.map(formatFlavor));
  } catch (err: any) {
    console.error('Error getting flavors:', err);
    res.status(500).json({ detail: 'Error al obtener sabores' });
  }
});

app.post('/api/flavors', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { name, price_usd, available, stock, stock_unlimited, image } = req.body || {};
    if (!name || price_usd === undefined) {
      res.status(400).json({ detail: 'Nombre y precio USD requeridos' });
      return;
    }
    const newFlavor = await prisma.flavor.create({
      data: {
        id: uuidv4(),
        name,
        price_usd: parseFloat(price_usd),
        available: available ?? true,
        stock: parseInt(stock || '0', 10),
        stock_unlimited: Boolean(stock_unlimited),
        image: image || null,
      },
    });
    res.json(formatFlavor(newFlavor));
  } catch (err: any) {
    console.error('Error creating flavor:', err);
    res.status(500).json({ detail: 'Error al crear sabor' });
  }
});

app.post('/api/flavors/reorder', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const order = req.body?.order;
    if (!Array.isArray(order)) {
      res.status(400).json({ detail: 'order debe ser una lista de ids' });
      return;
    }
    for (let idx = 0; idx < order.length; idx++) {
      const fid = order[idx];
      await prisma.flavor.updateMany({
        where: { id: fid },
        data: { sort_order: idx },
      });
    }
    res.json({ message: 'Orden actualizado', count: order.length });
  } catch (err: any) {
    console.error('Error reordering flavors:', err);
    res.status(500).json({ detail: 'Error al reordenar sabores' });
  }
});

app.put('/api/flavors/:flavor_id', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { flavor_id } = req.params;
    const existing = await prisma.flavor.findUnique({ where: { id: flavor_id } });
    if (!existing) {
      res.status(404).json({ detail: 'Sabor no encontrado' });
      return;
    }
    const { name, price_usd, available, stock, stock_unlimited, image } = req.body || {};
    const updated = await prisma.flavor.update({
      where: { id: flavor_id },
      data: {
        ...(name !== undefined && { name }),
        ...(price_usd !== undefined && { price_usd: parseFloat(price_usd) }),
        ...(available !== undefined && { available: Boolean(available) }),
        ...(stock !== undefined && { stock: parseInt(stock, 10) }),
        ...(stock_unlimited !== undefined && { stock_unlimited: Boolean(stock_unlimited) }),
        ...(image !== undefined && { image }),
      },
    });
    res.json(formatFlavor(updated));
  } catch (err: any) {
    console.error('Error updating flavor:', err);
    res.status(500).json({ detail: 'Error al actualizar sabor' });
  }
});

app.delete('/api/flavors/:flavor_id', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { flavor_id } = req.params;
    const existing = await prisma.flavor.findUnique({ where: { id: flavor_id } });
    if (!existing) {
      res.status(404).json({ detail: 'Sabor no encontrado' });
      return;
    }
    await prisma.flavor.delete({ where: { id: flavor_id } });
    res.json({ message: 'Sabor eliminado' });
  } catch (err: any) {
    console.error('Error deleting flavor:', err);
    res.status(500).json({ detail: 'Error al eliminar sabor' });
  }
});

app.post('/api/flavors/:flavor_id/stock-movement', requireRoles('admin'), async (req: AuthRequest, res: Response) => {
  try {
    const { flavor_id } = req.params;
    const flavor = await prisma.flavor.findUnique({ where: { id: flavor_id } });
    if (!flavor) {
      res.status(404).json({ detail: 'Sabor no encontrado' });
      return;
    }
    const delta = parseInt(req.body?.delta || '0', 10);
    const description = (req.body?.description || '').trim();
    if (delta === 0) {
      res.status(400).json({ detail: 'Cantidad debe ser distinta de 0' });
      return;
    }
    const newStock = Math.max(0, (flavor.stock || 0) + delta);
    await prisma.flavor.update({
      where: { id: flavor_id },
      data: { stock: newStock },
    });

    const user = req.user!;
    const movement = await prisma.stockMovement.create({
      data: {
        id: uuidv4(),
        flavor_id,
        flavor_name: flavor.name,
        delta,
        new_stock: newStock,
        description,
        user_id: user.user_id,
        user_name: user.name,
      },
    });

    res.json({
      id: movement.id,
      flavor_id: movement.flavor_id,
      flavor_name: movement.flavor_name,
      delta: movement.delta,
      new_stock: movement.new_stock,
      description: movement.description,
      user_id: movement.user_id,
      user_name: movement.user_name,
      created_at: movement.created_at.toISOString(),
    });
  } catch (err: any) {
    console.error('Error in stock movement:', err);
    res.status(500).json({ detail: 'Error al registrar movimiento de stock' });
  }
});

app.get('/api/flavors/:flavor_id/stock-movements', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { flavor_id } = req.params;
    const list = await prisma.stockMovement.findMany({
      where: { flavor_id },
      orderBy: { created_at: 'desc' },
    });
    res.json(
      list.map((m) => ({
        ...m,
        created_at: m.created_at.toISOString(),
      }))
    );
  } catch (err: any) {
    console.error('Error getting stock movements:', err);
    res.status(500).json({ detail: 'Error al obtener movimientos' });
  }
});

// ── 5. ORDERS & QUOTES ──

app.get('/api/orders', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { status, date_from, date_to } = req.query as Record<string, string>;

    const where: any = {};

    if (user.role === 'delivery') {
      where.delivery_id = user.user_id;
      where.status = { notIn: ['sin_pagar', 'cotizacion'] };
    } else {
      where.is_quote = false;
    }

    if (status) {
      if (status.includes(',')) {
        where.status = { in: status.split(',').filter(Boolean) };
      } else {
        where.status = status;
      }
    }

    const orders = await prisma.order.findMany({
      where,
      include: { items: true },
      orderBy: { created_at: 'desc' },
    });

    let filtered = orders.map(formatOrder);

    if (date_from) {
      filtered = filtered.filter((o) => o.created_at >= date_from);
    }
    if (date_to) {
      filtered = filtered.filter((o) => o.created_at <= date_to + 'T23:59:59');
    }

    // Attach delivery_photo_url
    const deliveries = await prisma.user.findMany({ where: { role: 'delivery' } });
    const photoMap = new Map<string, string | null>();
    deliveries.forEach((u) => {
      photoMap.set(u.id, u.photo_data_url || null);
    });

    let out = filtered.map((o) => ({
      ...o,
      delivery_photo_url: o.delivery_id ? photoMap.get(o.delivery_id) || null : null,
    }));

    if (user.role === 'delivery') {
      const pct = await getDeliveryDriverPct();
      const factor = pct / 100;
      out = out.map(o => ({
        ...o,
        delivery_fee: Math.round((o.delivery_fee || 0) * factor * 100) / 100,
      }));
    }

    res.json(out);
  } catch (err: any) {
    console.error('Error getting orders:', err);
    res.status(500).json({ detail: 'Error al obtener pedidos' });
  }
});

app.get('/api/orders/available', requireRoles('delivery'), async (req: Request, res: Response) => {
  try {
    const available = await prisma.order.findMany({
      where: {
        order_type: 'delivery',
        status: { in: ['pendiente', 'en_camino'] },
        delivery_id: null,
        is_quote: false,
      },
      include: { items: true },
      orderBy: { created_at: 'asc' },
    });

    const pct = await getDeliveryDriverPct();
    const factor = pct / 100;
    const formatted = available.map(formatOrder).map(o => ({
      ...o,
      delivery_fee: Math.round((o.delivery_fee || 0) * factor * 100) / 100,
    }));

    res.json(formatted);
  } catch (err: any) {
    console.error('Error getting available orders:', err);
    res.status(500).json({ detail: 'Error al obtener pedidos disponibles' });
  }
});

// Real-time driver GPS tracking store
const activeDriverLocations = new Map<string, {
  driver_id: string;
  driver_name: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number;
  order_id?: string;
  updated_at: string;
}>();

app.post('/api/delivery/location', requireRoles('delivery', 'admin'), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { lat, lng, heading = 0, speed = 0, order_id } = req.body || {};

    if (typeof lat !== 'number' || typeof lng !== 'number') {
      res.status(400).json({ detail: 'Coordenadas lat y lng requeridas' });
      return;
    }

    const now = new Date();

    // Fetch user to check current location_updated_at to avoid out-of-order queue replays
    const dbUser = await prisma.user.findUnique({ where: { id: user.user_id } });
    if (dbUser && dbUser.location_updated_at) {
      const dbTime = new Date(dbUser.location_updated_at);
      if (dbTime.getTime() >= now.getTime()) {
        console.log(`[DELIVERY GPS SKIP] Position skipped for ${user.name || user.username}. Incoming timestamp is older/equal to DB.`);
        res.json({ status: 'ok', message: 'Skipped older position' });
        return;
      }
    }

    // Persist to database so it matches traccar and registers correctly in /api/delivery/locations
    await prisma.user.update({
      where: { id: user.user_id },
      data: {
        location_lat: lat,
        location_lng: lng,
        location_updated_at: now,
      },
    });

    const locData = {
      driver_id: user.user_id,
      driver_name: user.username || user.name || 'Repartidor',
      lat,
      lng,
      heading: parseFloat(heading || 0),
      speed: parseFloat(speed || 0),
      order_id: order_id || undefined,
      updated_at: now.toISOString(),
    };

    activeDriverLocations.set(user.user_id, locData);
    if (order_id) {
      activeDriverLocations.set(`order_${order_id}`, locData);
    }

    // Broadcast both events to be fully compatible with any listener
    broadcastEvent('driver_location_changed', locData);
    broadcastEvent('location_update', {
      driver_id: user.user_id,
      name: user.name || user.username || 'Repartidor',
      username: user.username,
      color: dbUser?.color || null,
      photo_url: dbUser?.photo_data_url || null,
      lat,
      lng,
      speed: parseFloat(speed || 0),
      bearing: parseFloat(heading || 0),
      updated_at: now.toISOString(),
    });

    res.json({ status: 'ok', location: locData });
  } catch (err: any) {
    console.error('Error posting driver location:', err);
    res.status(500).json({ detail: 'Error al actualizar ubicación' });
  }
});

app.get('/api/delivery/location/:order_id', requireRoles('admin', 'vendedor', 'delivery'), async (req: Request, res: Response) => {
  try {
    const { order_id } = req.params;
    const loc = activeDriverLocations.get(`order_${order_id}`) || null;
    res.json({ location: loc });
  } catch (err: any) {
    res.status(500).json({ detail: 'Error al consultar ubicación' });
  }
});

app.post('/api/orders/:order_id/take', requireRoles('delivery'), async (req: AuthRequest, res: Response) => {
  try {
    const { order_id } = req.params;
    const user = req.user!;
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order) {
      res.status(404).json({ detail: 'Pedido no encontrado' });
      return;
    }
    if (order.wait_for_notice) {
      res.status(400).json({ detail: 'Este pedido tiene "esperar aviso" activo y no se puede tomar aún' });
      return;
    }
    if (order.delivery_id) {
      res.status(409).json({ detail: 'Pedido ya tomado por otro repartidor' });
      return;
    }
    await prisma.order.update({
      where: { id: order_id },
      data: {
        delivery_id: user.user_id,
        delivery_name: user.name,
      },
    });
    broadcastEvent('orders_changed', { order_id, action: 'take' });
    res.json({ message: 'Pedido tomado', order_id });
  } catch (err: any) {
    console.error('Error taking order:', err);
    res.status(500).json({ detail: 'Error al tomar pedido' });
  }
});

app.get('/api/quotes', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const quotes = await prisma.order.findMany({
      where: { is_quote: true, status: 'cotizacion' },
      include: { items: true },
      orderBy: { created_at: 'desc' },
    });
    res.json(quotes.map(formatOrder));
  } catch (err: any) {
    console.error('Error getting quotes:', err);
    res.status(500).json({ detail: 'Error al obtener cotizaciones' });
  }
});

app.delete('/api/quotes/:quote_id', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { quote_id } = req.params;
    await prisma.order.deleteMany({
      where: { id: quote_id, is_quote: true },
    });
    broadcastEvent('orders_changed', { quote_id, action: 'delete_quote' });
    res.json({ message: 'Cotización eliminada' });
  } catch (err: any) {
    console.error('Error deleting quote:', err);
    res.status(500).json({ detail: 'Error al eliminar cotización' });
  }
});

app.post('/api/quotes/:quote_id/convert', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { quote_id } = req.params;
    const customer_id = req.body?.customer_id;
    if (!customer_id) {
      res.status(400).json({ detail: 'customer_id requerido' });
      return;
    }
    const quote = await prisma.order.findFirst({
      where: { id: quote_id, is_quote: true },
      include: { items: true },
    });
    if (!quote) {
      res.status(404).json({ detail: 'Cotización no encontrada' });
      return;
    }
    const customer = await prisma.customer.findUnique({ where: { id: customer_id } });
    if (!customer) {
      res.status(404).json({ detail: 'Cliente no encontrado' });
      return;
    }

    // Deduct flavor stock
    for (const item of quote.items) {
      const f = await prisma.flavor.findUnique({ where: { id: item.flavor_id } });
      if (f && !f.stock_unlimited && f.stock >= item.quantity) {
        await prisma.flavor.update({
          where: { id: item.flavor_id },
          data: { stock: f.stock - item.quantity },
        });
      }
    }

    const now = new Date();
    const updatedQuote = await prisma.order.update({
      where: { id: quote_id },
      data: {
        customer_id,
        customer_name: customer.name,
        customer_phone: customer.phone || '',
        customer_gender: customer.gender || null,
        is_quote: false,
        status: 'pendiente',
        paid_at: now,
      },
      include: { items: true },
    });

    const admins = await prisma.user.findMany({ where: { role: 'admin' } });
    for (const adm of admins) {
      await prisma.notification.create({
        data: {
          id: uuidv4(),
          user_id: adm.id,
          type: 'new_sale',
          order_id: quote_id,
          message: `Cotización retomada: ${updatedQuote.order_number} - ${customer.name} - $${updatedQuote.total_usd.toFixed(2)}`,
        },
      });
    }

    broadcastEvent('orders_changed', { order_id: quote_id, action: 'convert_quote' });
    broadcastEvent('notifications_changed');
    broadcastEvent('flavors_changed');

    res.json(formatOrder(updatedQuote));
  } catch (err: any) {
    console.error('Error converting quote:', err);
    res.status(500).json({ detail: 'Error al convertir cotización' });
  }
});

app.post('/api/orders', requireRoles('admin', 'vendedor'), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = req.body || {};
    let customer: any = null;

    if (data.customer_id) {
      customer = await prisma.customer.findUnique({ where: { id: data.customer_id } });
      if (!customer) {
        res.status(404).json({ detail: 'Cliente no encontrado' });
        return;
      }
    } else if (!data.is_quote && data.order_type !== 'tienda') {
      res.status(400).json({ detail: 'Cliente requerido' });
      return;
    }

    const orderType = ['pickup', 'tienda'].includes(data.order_type) ? data.order_type : 'delivery';
    const isDelivery = orderType === 'delivery';
    const items: any[] = data.items || [];
    const itemsTotal = items.reduce((sum, i) => sum + (i.quantity || 0) * (i.price_usd || 0), 0);
    const fee = isDelivery ? parseFloat(data.delivery_fee || 0) : 0;
    const totalUsd = itemsTotal + fee;
    const orderId = uuidv4();

    let addressToStore = isDelivery ? (data.delivery_address || '') : '';
    let coords: [number, number] | null = null;
    if (isDelivery) {
      if (typeof data.lat === 'number' && typeof data.lng === 'number') {
        coords = [data.lat, data.lng];
        addressToStore = `https://www.google.com/maps/?q=${coords[0]},${coords[1]}`;
      } else if (data.delivery_address) {
        coords = parseCoordsFromUrl(data.delivery_address);
      }
    }

    const now = new Date();
    const isTiendaAutoDeliver = !data.is_quote && orderType === 'tienda';

    const newOrder = await prisma.order.create({
      data: {
        id: orderId,
        order_number: `PED-${orderId.substring(0, 8).toUpperCase()}`,
        customer_id: data.customer_id || null,
        customer_name: customer ? customer.name : (orderType === 'tienda' ? 'Venta en Tienda' : '(Cotización sin cliente)'),
        customer_phone: customer ? customer.phone : (orderType === 'tienda' ? 'N/A' : ''),
        customer_gender: customer ? customer.gender || null : null,
        order_type: orderType,
        delivery_address: addressToStore,
        lat: coords ? coords[0] : null,
        lng: coords ? coords[1] : null,
        delivery_id: null,
        delivery_name: orderType === 'pickup' ? 'Pickup en tienda' : (orderType === 'tienda' ? 'Venta en tienda' : null),
        delivery_fee: fee,
        status: data.is_quote ? 'cotizacion' : (isTiendaAutoDeliver ? 'entregado' : 'pendiente'),
        delivered_at: isTiendaAutoDeliver ? now : null,
        is_quote: Boolean(data.is_quote),
        quote_description: data.is_quote ? (data.quote_description || '').trim() : null,
        scheduled_for: data.scheduled_for || null,
        wait_for_notice: Boolean(data.wait_for_notice),
        total_usd: totalUsd,
        items_total: itemsTotal,
        notes: data.notes || '',
        velitas: Boolean(data.velitas),
        receiver_name: data.receiver_name ? data.receiver_name.trim() : null,
        receiver_phone: data.receiver_phone ? data.receiver_phone.trim() : null,
        created_by: user.user_id,
        created_by_name: user.name,
        paid_at: data.is_quote ? null : now,
        items: {
          create: items.map((i) => ({
            id: uuidv4(),
            flavor_id: i.flavor_id,
            flavor_name: i.flavor_name,
            quantity: i.quantity,
            price_usd: i.price_usd,
          })),
        },
      },
      include: { items: true },
    });

    if (!data.is_quote) {
      // Deduct stock
      for (const item of items) {
        const flavor = await prisma.flavor.findUnique({ where: { id: item.flavor_id } });
        if (flavor && !flavor.stock_unlimited && flavor.stock >= item.quantity) {
          await prisma.flavor.update({
            where: { id: item.flavor_id },
            data: { stock: flavor.stock - item.quantity },
          });
        }
      }

      // Notify admins & vendors
      const staff = await prisma.user.findMany({
        where: { role: { in: ['admin', 'vendedor'] }, NOT: { id: user.user_id } },
      });
      for (const u of staff) {
        await prisma.notification.create({
          data: {
            id: uuidv4(),
            user_id: u.id,
            type: 'order_paid',
            order_id: orderId,
            message: `${user.name} cobro el pedido ${newOrder.order_number} - ${newOrder.customer_name} - $${totalUsd.toFixed(2)}`,
          },
        });
      }

      // Notify delivery staff
      if (isDelivery) {
        const deliveries = await prisma.user.findMany({ where: { role: 'delivery' } });
        for (const u of deliveries) {
          await prisma.notification.create({
            data: {
              id: uuidv4(),
              user_id: u.id,
              type: 'order_available_for_delivery',
              order_id: orderId,
              message: `Nuevo pedido disponible ${newOrder.order_number} para ${newOrder.customer_name}`,
            },
          });
        }
      }
    }

    broadcastEvent('orders_changed', { order_id: orderId, action: 'create' });
    broadcastEvent('notifications_changed');
    if (!data.is_quote) broadcastEvent('flavors_changed');

    res.json(formatOrder(newOrder));
  } catch (err: any) {
    console.error('Error creating order:', err);
    res.status(500).json({ detail: 'Error al crear pedido' });
  }
});

app.patch('/api/orders/:order_id', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { order_id } = req.params;
    const order = await prisma.order.findUnique({ where: { id: order_id }, include: { items: true } });
    if (!order) {
      res.status(404).json({ detail: 'Pedido no encontrado' });
      return;
    }
    const data = req.body || {};
    const updateData: any = {};

    const newOrderType = data.order_type !== undefined ? data.order_type : order.order_type;
    updateData.order_type = newOrderType;

    if (newOrderType === 'pickup' || newOrderType === 'tienda') {
      updateData.delivery_fee = 0;
      updateData.delivery_id = null;
      updateData.delivery_name = newOrderType === 'pickup' ? 'Pickup en tienda' : 'Venta en tienda';
      updateData.lat = null;
      updateData.lng = null;
      updateData.total_usd = Math.round((order.items_total) * 100) / 100;
      if (data.delivery_address !== undefined) updateData.delivery_address = '';
    } else {
      if (data.delivery_address !== undefined) {
        updateData.delivery_address = data.delivery_address;
        if (data.lat == null && data.lng == null && data.delivery_address) {
          const coords = parseCoordsFromUrl(data.delivery_address);
          if (coords) {
            updateData.lat = coords[0];
            updateData.lng = coords[1];
          }
        }
      }
      if (data.lat !== undefined) updateData.lat = data.lat;
      if (data.lng !== undefined) updateData.lng = data.lng;

      const fee = data.delivery_fee !== undefined ? parseFloat(data.delivery_fee || 0) : order.delivery_fee;
      updateData.delivery_fee = fee;
      updateData.total_usd = Math.round((order.items_total + fee) * 100) / 100;
    }

    if (data.scheduled_for !== undefined) updateData.scheduled_for = data.scheduled_for;
    if (data.wait_for_notice !== undefined) updateData.wait_for_notice = Boolean(data.wait_for_notice);
    if (data.notes !== undefined) updateData.notes = data.notes;

    if (data.customer_id && data.customer_id !== order.customer_id) {
      const cust = await prisma.customer.findUnique({ where: { id: data.customer_id } });
      if (cust) {
        updateData.customer_id = cust.id;
        updateData.customer_name = cust.name;
        updateData.customer_phone = cust.phone;
        updateData.customer_gender = cust.gender || null;
      }
    }

    const updated = await prisma.order.update({
      where: { id: order_id },
      data: updateData,
      include: { items: true },
    });

    broadcastEvent('orders_changed', { order_id, action: 'update' });
    res.json(formatOrder(updated));
  } catch (err: any) {
    console.error('Error updating order:', err);
    res.status(500).json({ detail: 'Error al actualizar pedido' });
  }
});

app.patch('/api/orders/:order_id/toggle-wait-notice', requireRoles('admin', 'vendedor', 'delivery'), async (req: Request, res: Response) => {
  try {
    const { order_id } = req.params;
    const order = await prisma.order.findUnique({ where: { id: order_id }, include: { items: true } });
    if (!order) {
      res.status(404).json({ detail: 'Pedido no encontrado' });
      return;
    }
    const nextState = req.body?.wait_for_notice !== undefined ? Boolean(req.body.wait_for_notice) : !order.wait_for_notice;
    const updated = await prisma.order.update({
      where: { id: order_id },
      data: { wait_for_notice: nextState },
      include: { items: true },
    });
    broadcastEvent('orders_changed', { order_id, action: 'toggle_wait' });
    res.json(formatOrder(updated));
  } catch (err: any) {
    console.error('Error toggling wait notice:', err);
    res.status(500).json({ detail: 'Error al cambiar estado de esperar aviso' });
  }
});

app.patch('/api/orders/:order_id/prepared', requireRoles('admin', 'vendedor'), async (req: AuthRequest, res: Response) => {
  try {
    const { order_id } = req.params;
    const user = req.user!;
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order) {
      res.status(404).json({ detail: 'Pedido no encontrado' });
      return;
    }
    const prepared = Boolean(req.body?.prepared);
    const now = new Date();

    const updated = await prisma.order.update({
      where: { id: order_id },
      data: {
        prepared,
        prepared_at: prepared ? now : null,
        prepared_by_name: prepared ? user.name : null,
      },
      include: { items: true },
    });

    broadcastEvent('orders_changed', { order_id, action: 'prepared' });
    res.json(formatOrder(updated));
  } catch (err: any) {
    console.error('Error updating prepared status:', err);
    res.status(500).json({ detail: 'Error al actualizar estado preparado' });
  }
});

app.post('/api/orders/:order_id/assign-delivery', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { order_id } = req.params;
    const delivery_id = req.body?.delivery_id;
    if (!delivery_id) {
      res.status(400).json({ detail: 'delivery_id requerido' });
      return;
    }
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order) {
      res.status(404).json({ detail: 'Pedido no encontrado' });
      return;
    }
    if (order.order_type === 'pickup') {
      res.status(400).json({ detail: 'Pickups no se asignan a delivery' });
      return;
    }
    const deliveryUser = await prisma.user.findFirst({
      where: { id: delivery_id, role: 'delivery' },
    });
    if (!deliveryUser) {
      res.status(404).json({ detail: 'Delivery no encontrado' });
      return;
    }

    const updateData: any = {
      delivery_id,
      delivery_name: deliveryUser.name,
    };
    if (order.status === 'en_camino') {
      updateData.status = 'pendiente';
    }

    await prisma.order.update({
      where: { id: order_id },
      data: updateData,
    });

    await prisma.notification.create({
      data: {
        id: uuidv4(),
        user_id: delivery_id,
        type: 'new_order',
        order_id,
        message: `Nuevo pedido asignado: ${order.order_number} - ${order.customer_name}`,
      },
    });

    broadcastEvent('orders_changed', { order_id, action: 'assign' });
    broadcastEvent('notifications_changed');
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Error assigning delivery:', err);
    res.status(500).json({ detail: 'Error al asignar repartidor' });
  }
});

app.post('/api/orders/:order_id/unassign-delivery', requireRoles('admin', 'vendedor', 'delivery'), async (req: AuthRequest, res: Response) => {
  try {
    const { order_id } = req.params;
    const user = req.user!;
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order) {
      res.status(404).json({ detail: 'Pedido no encontrado' });
      return;
    }
    if (user.role === 'delivery' && order.delivery_id !== user.user_id) {
      res.status(403).json({ detail: 'Solo puedes liberar tus propios pedidos' });
      return;
    }

    const newStatus = order.status === 'en_camino' ? 'pendiente' : order.status;

    await prisma.order.update({
      where: { id: order_id },
      data: {
        delivery_id: null,
        delivery_name: null,
        status: newStatus,
      },
    });

    const otherUsers = await prisma.user.findMany({ where: { NOT: { id: user.user_id } } });
    for (const u of otherUsers) {
      await prisma.notification.create({
        data: {
          id: uuidv4(),
          user_id: u.id,
          type: 'order_released',
          order_id,
          message: `${user.name} libero el pedido ${order.order_number} - disponible para tomar`,
        },
      });
    }

    broadcastEvent('orders_changed', { order_id, action: 'unassign' });
    broadcastEvent('notifications_changed');
    res.json({ message: 'Pedido liberado a Disponibles', order_id });
  } catch (err: any) {
    console.error('Error unassigning delivery:', err);
    res.status(500).json({ detail: 'Error al liberar pedido' });
  }
});

app.delete('/api/orders/:order_id', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { order_id } = req.params;
    const order = await prisma.order.findUnique({
      where: { id: order_id },
      include: { items: true },
    });
    if (!order) {
      res.status(404).json({ detail: 'Pedido no encontrado' });
      return;
    }

    if (!order.is_quote && !['cotizacion', 'cancelado'].includes(order.status)) {
      // Restore flavor stock
      for (const item of order.items) {
        const f = await prisma.flavor.findUnique({ where: { id: item.flavor_id } });
        if (f && !f.stock_unlimited) {
          await prisma.flavor.update({
            where: { id: item.flavor_id },
            data: { stock: f.stock + item.quantity },
          });
        }
      }
    }

    await prisma.order.delete({ where: { id: order_id } });
    broadcastEvent('orders_changed', { order_id, action: 'delete' });
    broadcastEvent('flavors_changed');
    res.json({ message: 'Pedido eliminado', order_id });
  } catch (err: any) {
    console.error('Error deleting order:', err);
    res.status(500).json({ detail: 'Error al eliminar pedido' });
  }
});

app.patch('/api/orders/:order_id/status', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { order_id } = req.params;
    const user = req.user!;
    const newStatus = req.body?.status;
    const order = await prisma.order.findUnique({ where: { id: order_id } });
    if (!order) {
      res.status(404).json({ detail: 'Pedido no encontrado' });
      return;
    }
    if (user.role === 'delivery') {
      if (!['en_camino', 'entregado', 'pendiente'].includes(newStatus)) {
        res.status(403).json({ detail: 'Sin permisos para este estado' });
        return;
      }
      if (order.delivery_id !== user.user_id) {
        res.status(403).json({ detail: 'No es tu pedido asignado' });
        return;
      }
    }

    const oldStatus = order.status;
    const now = new Date();
    const updateData: any = { status: newStatus };

    if (['sin_pagar', 'cotizacion'].includes(oldStatus) && !['sin_pagar', 'cotizacion', 'cancelado'].includes(newStatus) && !order.paid_at) {
      updateData.paid_at = now;
    }
    if (newStatus === 'entregado' && oldStatus !== 'entregado') {
      updateData.delivered_at = now;
      updateData.route_polyline = null;

      const adminVendors = await prisma.user.findMany({ where: { role: { in: ['admin', 'vendedor'] } } });
      for (const u of adminVendors) {
        if (u.id !== user.user_id) {
          await prisma.notification.create({
            data: {
              id: uuidv4(),
              user_id: u.id,
              type: 'order_delivered',
              order_id,
              message: `El pedido ${order.order_number} (${order.customer_name}) ha sido entregado por ${user.name}`,
            },
          });
        }
      }
    }
    if (oldStatus === 'entregado' && newStatus !== 'entregado') {
      updateData.delivered_at = null;

      const adminVendors = await prisma.user.findMany({ where: { role: { in: ['admin', 'vendedor'] } } });
      for (const u of adminVendors) {
        if (u.id !== user.user_id) {
          await prisma.notification.create({
            data: {
              id: uuidv4(),
              user_id: u.id,
              type: 'order_reverted',
              order_id,
              message: `${user.name} revirtió el pedido ${order.order_number} (${order.customer_name}) a ${newStatus === 'en_camino' ? 'En Camino' : 'Pendiente'}`,
            },
          });
        }
      }
    }

    if (
      newStatus === 'en_camino' &&
      oldStatus !== 'en_camino' &&
      order.order_type !== 'pickup' &&
      order.lat != null &&
      order.lng != null &&
      !order.route_polyline
    ) {
      const deliveryUser = await prisma.user.findUnique({ where: { id: user.user_id } });
      if (deliveryUser?.location_lat != null && deliveryUser?.location_lng != null) {
        const poly = await fetchDirectionsPolyline(
          deliveryUser.location_lat,
          deliveryUser.location_lng,
          order.lat,
          order.lng
        );
        if (poly) {
          updateData.route_polyline = poly;
          updateData.route_origin_lat = deliveryUser.location_lat;
          updateData.route_origin_lng = deliveryUser.location_lng;
        }
      }
    }

    await prisma.order.update({
      where: { id: order_id },
      data: updateData,
    });

    broadcastEvent('orders_changed', { order_id, action: 'status_change', status: newStatus });
    broadcastEvent('notifications_changed');
    res.json({ message: 'Estado actualizado', status: newStatus });
  } catch (err: any) {
    console.error('Error updating order status:', err);
    res.status(500).json({ detail: 'Error al actualizar estado de pedido' });
  }
});

app.get('/api/orders/heatmap', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: { not: 'cancelado' } },
    });
    const points: any[] = [];
    orders.forEach((o) => {
      let lat = o.lat;
      let lng = o.lng;
      if (lat == null || lng == null) {
        const coords = parseCoordsFromUrl(o.delivery_address);
        if (coords) [lat, lng] = coords;
      }
      if (lat != null && lng != null) {
        points.push({ lat, lng, revenue: o.total_usd, count: 1 });
      }
    });
    res.json({ points, total: points.length });
  } catch (err: any) {
    console.error('Error getting heatmap:', err);
    res.status(500).json({ detail: 'Error al obtener datos de mapa de calor' });
  }
});

// ── 6. SETTINGS & PUBLIC ──

app.get('/api/settings', authMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await prisma.appSettings.findUnique({ where: { key: 'app_settings' } });
    res.json(
      settings
        ? {
            key: settings.key,
            exchange_rate_ves: settings.exchange_rate_ves ?? 36.5,
            delivery_driver_pct: settings.delivery_driver_pct ?? 85.0,
            central_point_url: settings.central_point_url,
            central_point_lat: settings.central_point_lat,
            central_point_lng: settings.central_point_lng,
            logo_url: settings.logo_url || '/logo.svg',
            favicon_url: settings.favicon_url || '/isotipo.webp',
            font_family: settings.font_family || 'Playfair Display',
            primary_color: settings.primary_color || '#501122',
            secondary_color: settings.secondary_color || '#FBF7F0',
            app_title: settings.app_title || "Lubo's Tiramisú",
            app_subtitle: settings.app_subtitle || 'Gestión y Logística',
            updated_at: settings.updated_at ? settings.updated_at.toISOString() : undefined,
          }
        : {
            exchange_rate_ves: 36.5,
            delivery_driver_pct: 85.0,
            logo_url: '/logo.svg',
            favicon_url: '/isotipo.webp',
            font_family: 'Playfair Display',
            primary_color: '#501122',
            secondary_color: '#FBF7F0',
            app_title: "Lubo's Tiramisú",
            app_subtitle: 'Gestión y Logística',
          }
    );
  } catch (err: any) {
    console.error('Error getting settings:', err);
    res.status(500).json({ detail: 'Error al obtener configuración' });
  }
});

app.put('/api/settings', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const {
      exchange_rate_ves,
      delivery_driver_pct,
      central_point_url,
      central_point_lat,
      central_point_lng,
      logo_url,
      favicon_url,
      font_family,
      primary_color,
      secondary_color,
      app_title,
      app_subtitle,
    } = req.body || {};
    const updateData: any = {};

    if (exchange_rate_ves !== undefined) updateData.exchange_rate_ves = parseFloat(exchange_rate_ves);
    if (delivery_driver_pct !== undefined) updateData.delivery_driver_pct = parseFloat(delivery_driver_pct);
    if (logo_url !== undefined) updateData.logo_url = logo_url;
    if (favicon_url !== undefined) updateData.favicon_url = favicon_url;
    if (font_family !== undefined) updateData.font_family = font_family;
    if (primary_color !== undefined) updateData.primary_color = primary_color;
    if (secondary_color !== undefined) updateData.secondary_color = secondary_color;
    if (app_title !== undefined) updateData.app_title = app_title;
    if (app_subtitle !== undefined) updateData.app_subtitle = app_subtitle;

    if (central_point_url !== undefined) {
      if (central_point_url === '') {
        updateData.central_point_url = null;
        updateData.central_point_lat = null;
        updateData.central_point_lng = null;
      } else {
        const coords = parseCoordsFromUrl(central_point_url);
        if (coords) {
          updateData.central_point_url = central_point_url;
          updateData.central_point_lat = coords[0];
          updateData.central_point_lng = coords[1];
        } else {
          res.status(400).json({ detail: 'No se pudieron extraer coordenadas del link' });
          return;
        }
      }
    } else if (central_point_lat !== undefined && central_point_lng !== undefined) {
      updateData.central_point_lat = central_point_lat;
      updateData.central_point_lng = central_point_lng;
    }

    const settings = await prisma.appSettings.upsert({
      where: { key: 'app_settings' },
      update: updateData,
      create: {
        key: 'app_settings',
        exchange_rate_ves: updateData.exchange_rate_ves ?? 36.5,
        delivery_driver_pct: updateData.delivery_driver_pct ?? 85.0,
        logo_url: updateData.logo_url ?? '/logo.svg',
        favicon_url: updateData.favicon_url ?? '/isotipo.webp',
        font_family: updateData.font_family ?? 'Playfair Display',
        primary_color: updateData.primary_color ?? '#501122',
        secondary_color: updateData.secondary_color ?? '#FBF7F0',
        app_title: updateData.app_title ?? "Lubo's Tiramisú",
        app_subtitle: updateData.app_subtitle ?? 'Gestión y Logística',
        ...updateData,
      },
    });

    broadcastEvent('settings_changed');

    res.json({
      key: settings.key,
      exchange_rate_ves: settings.exchange_rate_ves ?? 36.5,
      delivery_driver_pct: settings.delivery_driver_pct ?? 85.0,
      central_point_url: settings.central_point_url,
      central_point_lat: settings.central_point_lat,
      central_point_lng: settings.central_point_lng,
      logo_url: settings.logo_url || '/logo.svg',
      favicon_url: settings.favicon_url || '/isotipo.webp',
      font_family: settings.font_family || 'Playfair Display',
      primary_color: settings.primary_color || '#501122',
      secondary_color: settings.secondary_color || '#FBF7F0',
      app_title: settings.app_title || "Lubo's Tiramisú",
      app_subtitle: settings.app_subtitle || 'Gestión y Logística',
      updated_at: settings.updated_at ? settings.updated_at.toISOString() : undefined,
    });
  } catch (err: any) {
    console.error('Error updating settings:', err);
    res.status(500).json({ detail: 'Error al actualizar configuración' });
  }
});

app.get('/api/widget-settings', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const defaults = {
      msg_stock_1: 'Quedan 1',
      msg_stock_2: 'Quedan 2',
      msg_stock_3: 'Quedan 3',
      msg_stock_4: 'Quedan 4',
      msg_stock_5: 'Quedan 5',
      msg_out: 'Agotados',
    };
    const settings = await prisma.widgetSettings.findUnique({ where: { key: 'widget_settings' } });
    res.json({ ...defaults, ...(settings || {}) });
  } catch (err: any) {
    console.error('Error getting widget settings:', err);
    res.status(500).json({ detail: 'Error al obtener configuración de widget' });
  }
});

app.put('/api/widget-settings', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const settings = await prisma.widgetSettings.upsert({
      where: { key: 'widget_settings' },
      update: body,
      create: {
        key: 'widget_settings',
        ...body,
      },
    });
    const { key, updated_at, ...rest } = settings;
    res.json(rest);
  } catch (err: any) {
    console.error('Error updating widget settings:', err);
    res.status(500).json({ detail: 'Error al actualizar configuración de widget' });
  }
});

app.get('/api/public/widget-config', async (req: Request, res: Response) => {
  try {
    const defaults = {
      msg_stock_1: 'Quedan 1',
      msg_stock_2: 'Quedan 2',
      msg_stock_3: 'Quedan 3',
      msg_stock_4: 'Quedan 4',
      msg_stock_5: 'Quedan 5',
      msg_out: 'Agotados',
    };
    const settings = (await prisma.widgetSettings.findUnique({ where: { key: 'widget_settings' } })) || {};
    res.json({ ...defaults, ...settings });
  } catch (err: any) {
    console.error('Error getting public widget config:', err);
    res.status(500).json({ detail: 'Error al obtener configuración pública' });
  }
});

app.get('/api/public/stock', async (req: Request, res: Response) => {
  try {
    const flavors = await prisma.flavor.findMany({
      where: { available: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    });
    res.json(
      flavors.map((f) => ({
        id: f.id,
        name: f.name,
        stock: f.stock || 0,
        price_usd: f.price_usd || 0,
      }))
    );
  } catch (err: any) {
    console.error('Error getting public stock:', err);
    res.status(500).json({ detail: 'Error al obtener stock público' });
  }
});

app.get('/api/bcv-rate', authMiddleware, async (req: Request, res: Response) => {
  try {
    console.log('[API/BCV-RATE] Manual request received, fetching live rate...');
    const liveRate = await fetchLiveBcvRate();
    if (liveRate && liveRate > 0) {
      const settings = await prisma.appSettings.upsert({
        where: { key: 'app_settings' },
        update: { exchange_rate_ves: liveRate },
        create: { key: 'app_settings', exchange_rate_ves: liveRate, delivery_driver_pct: 85.0 }
      });
      console.log(`[API/BCV-RATE] Database successfully updated to live rate: ${liveRate}`);
      broadcastEvent('settings_changed');
      res.json({ rate: liveRate, source: 'bcv_official', updated: true });
    } else {
      // Fallback to currently stored rate
      const settings = await prisma.appSettings.findUnique({ where: { key: 'app_settings' } });
      const rate = settings?.exchange_rate_ves || 36.5;
      res.json({ rate, source: 'bcv_official', updated: false, message: 'Fallback to DB rate' });
    }
  } catch (err: any) {
    console.error('Error getting BCV rate:', err);
    res.status(500).json({ detail: 'Error al obtener tasa BCV' });
  }
});

// ── 7. FINANCE & DASHBOARD ──

app.get('/api/finance/daily', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const dateStr = (req.query.date as string) || new Date().toISOString().substring(0, 10);

    const dbDrivers = await prisma.user.findMany({ where: { role: { in: ['repartidor', 'delivery'] } } });

    const allOrders = await prisma.order.findMany({
      where: { is_quote: false },
      include: { items: true },
    });

    const salesOrders = allOrders.filter((o) => {
      if (o.status === 'cancelado' || o.status === 'cotizacion' || o.status === 'sin_pagar') return false;
      const dt = (o.paid_at || o.created_at).toISOString().substring(0, 10);
      return dt === dateStr;
    });

    const revenueTotal = salesOrders.reduce((sum, o) => sum + (o.total_usd || 0), 0);
    const revenueDelivery = salesOrders.reduce((sum, o) => sum + (o.delivery_fee || 0), 0);
    const revenueProducts = revenueTotal - revenueDelivery;

    // Flavors breakdown
    const flavorMap = new Map<string, { id: string; name: string; quantity: number; revenue: number }>();
    salesOrders.forEach((o) => {
      o.items.forEach((it) => {
        const name = it.flavor_name || it.flavor_id || 'Sin sabor';
        const entry = flavorMap.get(name) || { id: name, name: name, quantity: 0, revenue: 0 };
        entry.quantity += it.quantity;
        entry.revenue += it.quantity * it.price_usd;
        flavorMap.set(name, entry);
      });
    });

    const deliveredToday = allOrders.filter((o) => {
      if (o.status !== 'entregado' || o.order_type === 'pickup') return false;
      const dt = (o.delivered_at || o.created_at).toISOString().substring(0, 10);
      return dt === dateStr;
    });

    // Drivers breakdown
    const driverMap = new Map<string, { id: string; name: string; earned: number; delivered_count: number; pending_amount: number; pending_count: number; orders: any[] }>();
    dbDrivers.forEach((d) => {
      driverMap.set(d.id, {
        id: d.id,
        name: d.name,
        earned: 0,
        delivered_count: 0,
        pending_amount: 0,
        pending_count: 0,
        orders: [],
      });
    });

    let pendingUnassignedAmount = 0;
    let pendingUnassignedCount = 0;

    // Delivered orders today
    deliveredToday.forEach((o) => {
      let driverKey = o.delivery_id;
      if (!driverKey && o.delivery_name) {
        const match = dbDrivers.find((d) => d.name.toLowerCase() === o.delivery_name!.toLowerCase());
        if (match) driverKey = match.id;
      }

      const orderItemData = {
        id: o.id,
        order_number: o.order_number,
        customer_name: o.customer_name,
        delivery_fee: o.delivery_fee || 0,
        delivered_at: o.delivered_at || o.created_at,
        items: (o.items || []).map((it) => ({ quantity: it.quantity, flavor_name: it.flavor_name })),
      };

      if (driverKey && driverMap.has(driverKey)) {
        const d = driverMap.get(driverKey)!;
        d.earned += o.delivery_fee || 0;
        d.delivered_count += 1;
        d.orders.push(orderItemData);
      } else if (o.delivery_name) {
        const dKey = o.delivery_name;
        if (!driverMap.has(dKey)) {
          driverMap.set(dKey, {
            id: dKey,
            name: o.delivery_name,
            earned: 0,
            delivered_count: 0,
            pending_amount: 0,
            pending_count: 0,
            orders: [],
          });
        }
        const d = driverMap.get(dKey)!;
        d.earned += o.delivery_fee || 0;
        d.delivered_count += 1;
        d.orders.push(orderItemData);
      }
    });

    // Pending orders on dateStr
    const pendingOrders = allOrders.filter((o) => {
      if (o.status === 'cancelado' || o.status === 'entregado' || o.status === 'cotizacion' || o.order_type === 'pickup') return false;
      const dt = o.created_at.toISOString().substring(0, 10);
      return dt === dateStr;
    });

    pendingOrders.forEach((o) => {
      let driverKey = o.delivery_id;
      if (!driverKey && o.delivery_name) {
        const match = dbDrivers.find((d) => d.name.toLowerCase() === o.delivery_name!.toLowerCase());
        if (match) driverKey = match.id;
      }

      if (driverKey && driverMap.has(driverKey)) {
        const d = driverMap.get(driverKey)!;
        d.pending_amount += o.delivery_fee || 0;
        d.pending_count += 1;
      } else {
        pendingUnassignedAmount += o.delivery_fee || 0;
        pendingUnassignedCount += 1;
      }
    });

    res.json({
      date: dateStr,
      totals: {
        revenue_total: Math.round(revenueTotal * 100) / 100,
        revenue_products: Math.round(revenueProducts * 100) / 100,
        revenue_delivery: Math.round(revenueDelivery * 100) / 100,
      },
      flavors: Array.from(flavorMap.values()).map((f) => ({ ...f, revenue: Math.round(f.revenue * 100) / 100 })),
      deliveries: Array.from(driverMap.values())
        .map((d) => ({
          ...d,
          earned: Math.round(d.earned * 100) / 100,
          pending_amount: Math.round(d.pending_amount * 100) / 100,
        }))
        .filter((d) => d.delivered_count > 0 || d.pending_count > 0),
      pending_unassigned: {
        amount: Math.round(pendingUnassignedAmount * 100) / 100,
        count: pendingUnassignedCount,
      },
      summary_orders: {
        paid_today: salesOrders.length,
        delivered_today: deliveredToday.length,
        cancelled_today: allOrders.filter((o) => o.status === 'cancelado' && o.created_at.toISOString().substring(0, 10) === dateStr).length,
      },
    });
  } catch (err: any) {
    console.error('Error getting daily finance:', err);
    res.status(500).json({ detail: 'Error al obtener finanzas diarias' });
  }
});

app.get('/api/dashboard/client-stats', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    const limit = Math.max(1, Math.min(parseInt((req.query.limit as string) || '50', 10), 200));

    const total_customers = await prisma.customer.count();

    const deliveredOrders = await prisma.order.findMany({
      where: { status: { not: 'cancelado' }, is_quote: false },
      select: { customer_id: true, customer_phone: true },
    });

    const allCustomers = await prisma.customer.findMany();
    const formattedCustomers = allCustomers.map(formatCustomer);

    const phoneMap = new Map<string, string>();
    allCustomers.forEach((c) => {
      const pDigits = (c.phone || '').replace(/[^0-9]/g, '');
      if (pDigits.length >= 7) {
        phoneMap.set(pDigits.slice(-10), c.id);
      }
    });

    const countsMap = new Map<string, number>();
    deliveredOrders.forEach((o) => {
      let cId = o.customer_id;
      if (!cId && o.customer_phone) {
        const oDigits = o.customer_phone.replace(/[^0-9]/g, '');
        if (oDigits.length >= 7) cId = phoneMap.get(oDigits.slice(-10)) || null;
      }
      if (cId) {
        countsMap.set(cId, (countsMap.get(cId) || 0) + 1);
      }
    });

    let listWithCounts = formattedCustomers.map((c) => ({
      ...c,
      order_count: countsMap.get(c.id) || 0,
    }));

    const repeat_customers = listWithCounts.filter((c) => (c.order_count || 0) > 1).length;

    if (q) {
      const qNormalized = normalizeText(q).trim();
      const tokens = qNormalized.split(/\s+/).filter(Boolean);
      const digits = q.replace(/[^0-9]/g, '');

      listWithCounts = listWithCounts.filter((c) => {
        const nameNorm = normalizeText(c.name);
        const phoneNorm = normalizeText(c.phone || '');
        const phoneDigits = (c.phone || '').replace(/[^0-9]/g, '');

        const matchesTokens = tokens.length > 0 && tokens.every(
          (tok) => nameNorm.includes(tok) || phoneNorm.includes(tok)
        );
        const matchesDigits = !!(digits && phoneDigits.includes(digits));

        return matchesTokens || matchesDigits;
      });
    }

    // Sort by order_count desc (most delivered orders to least), then created_at desc
    listWithCounts.sort((a, b) => (b.order_count - a.order_count) || (new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()));

    const topCustomers = listWithCounts.slice(0, limit);

    res.json({
      total_customers,
      repeat_customers,
      active_in_period: total_customers,
      period_revenue: 0,
      period_orders: 0,
      customers: topCustomers,
    });
  } catch (err: any) {
    console.error('Error getting client stats:', err);
    res.status(500).json({ detail: 'Error al obtener estadísticas de clientes' });
  }
});

app.get('/api/dashboard/stats', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const total_orders = await prisma.order.count();
    const total_customers = await prisma.customer.count();
    const total_pending = await prisma.order.count({ where: { status: 'pendiente' } });

    const deliveredOrders = await prisma.order.findMany({
      where: { status: { not: 'cancelado' }, is_quote: false },
      select: { total_usd: true },
    });
    const total_revenue_usd = deliveredOrders.reduce((sum, o) => sum + (o.total_usd || 0), 0);

    res.json({
      total_orders,
      total_customers,
      total_pending,
      total_revenue_usd: Math.round(total_revenue_usd * 100) / 100,
      daily_stats: [],
    });
  } catch (err: any) {
    console.error('Error getting dashboard stats:', err);
    res.status(500).json({ detail: 'Error al obtener estadísticas del dashboard' });
  }
});

app.get('/api/dashboard/records', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const orders = await prisma.order.findMany({
      where: {
        is_quote: false,
        status: { notIn: ['cancelado', 'cotizacion', 'sin_pagar'] },
      },
      select: { created_at: true, paid_at: true, total_usd: true },
    });

    const daysMap: Record<string, number> = {};
    const monthsMap: Record<string, number> = {};

    orders.forEach((o) => {
      const dt = o.paid_at || o.created_at;
      const veDt = new Date(dt.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
      const dStr = veDt.toISOString().substring(0, 10);
      const mStr = dStr.substring(0, 7);

      daysMap[dStr] = (daysMap[dStr] || 0) + (o.total_usd || 0);
      monthsMap[mStr] = (monthsMap[mStr] || 0) + (o.total_usd || 0);
    });

    const veNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const todayStr = `${veNow.getFullYear()}-${String(veNow.getMonth() + 1).padStart(2, '0')}-${String(veNow.getDate()).padStart(2, '0')}`;
    const currentMonthStr = todayStr.substring(0, 7);

    const todayRev = Math.round((daysMap[todayStr] || 0) * 100) / 100;
    const currentMonthRev = Math.round((monthsMap[currentMonthStr] || 0) * 100) / 100;

    const pastDaysList = Object.entries(daysMap)
      .filter(([d]) => d !== todayStr)
      .map(([date, total]) => ({ date, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    const top_days = pastDaysList.slice(0, 5);

    const pastMaxDayRecord = pastDaysList.length > 0 ? pastDaysList[0].total : todayRev;
    const pastMaxDayRecordDate = pastDaysList.length > 0 ? pastDaysList[0].date : todayStr;
    const dailyBroken = pastDaysList.length > 0 ? todayRev > pastMaxDayRecord : false;

    const pastMonthsList = Object.entries(monthsMap)
      .filter(([m]) => m !== currentMonthStr)
      .map(([month, total]) => ({ month, total: Math.round(total * 100) / 100 }))
      .sort((a, b) => b.total - a.total);

    const monthNamesES = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
    ];

    const formatMonthName = (mStr: string) => {
      if (!mStr) return '';
      const [y, m] = mStr.split('-').map(Number);
      return `${monthNamesES[(m || 1) - 1]} ${y}`;
    };

    const isFirstMonth = pastMonthsList.length === 0;
    const pastMaxMonthRecord = !isFirstMonth ? pastMonthsList[0].total : currentMonthRev;
    const pastMaxMonthRecordName = !isFirstMonth ? formatMonthName(pastMonthsList[0].month) : formatMonthName(currentMonthStr);
    const monthlyBroken = !isFirstMonth ? currentMonthRev > pastMaxMonthRecord : false;

    res.json({
      today: {
        revenue: todayRev,
        record: pastMaxDayRecord,
        record_date: pastMaxDayRecordDate,
        broken: dailyBroken,
      },
      month: {
        revenue: currentMonthRev,
        record: pastMaxMonthRecord,
        record_month: pastMaxMonthRecordName,
        broken: monthlyBroken,
        is_first_month: isFirstMonth,
      },
      top_days,
    });
  } catch (err: any) {
    console.error('Error fetching records:', err);
    res.status(500).json({ detail: 'Error al obtener records' });
  }
});

app.get('/api/dashboard/report', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { preset = 'today', date_from, date_to, status } = req.query as Record<string, string>;

    const allOrders = await prisma.order.findMany({
      include: { items: true },
      orderBy: { created_at: 'asc' },
    });
    const allCustomers = await prisma.customer.findMany();
    const dbDrivers = await prisma.user.findMany({ where: { role: { in: ['repartidor', 'delivery'] } } });

    // Calculate dates in America/Caracas timezone (VE)
    const veNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const todayStr = `${veNow.getFullYear()}-${String(veNow.getMonth() + 1).padStart(2, '0')}-${String(veNow.getDate()).padStart(2, '0')}`;

    let startDateStr = '';
    let endDateStr = '';

    if (preset === 'today') {
      startDateStr = todayStr;
      endDateStr = todayStr;
    } else if (preset === 'yesterday') {
      const y = new Date(veNow);
      y.setDate(y.getDate() - 1);
      startDateStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
      endDateStr = startDateStr;
    } else if (preset === 'last7') {
      const d = new Date(veNow);
      d.setDate(d.getDate() - 6);
      startDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      endDateStr = todayStr;
    } else if (preset === 'this_week') {
      const d = new Date(veNow);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      startDateStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
      endDateStr = todayStr;
    } else if (preset === 'last_week') {
      const d = new Date(veNow);
      const day = d.getDay();
      const diffToMon = d.getDate() - day + (day === 0 ? -6 : 1) - 7;
      const lastMon = new Date(d.setDate(diffToMon));
      const lastSun = new Date(lastMon);
      lastSun.setDate(lastSun.getDate() + 6);
      startDateStr = `${lastMon.getFullYear()}-${String(lastMon.getMonth() + 1).padStart(2, '0')}-${String(lastMon.getDate()).padStart(2, '0')}`;
      endDateStr = `${lastSun.getFullYear()}-${String(lastSun.getMonth() + 1).padStart(2, '0')}-${String(lastSun.getDate()).padStart(2, '0')}`;
    } else if (preset === 'this_month') {
      startDateStr = `${todayStr.substring(0, 7)}-01`;
      endDateStr = todayStr;
    } else if (preset === 'last_month') {
      const [year, month] = todayStr.substring(0, 7).split('-').map(Number);
      const prevMonth = month === 1 ? 12 : month - 1;
      const prevYear = month === 1 ? year - 1 : year;
      const pStr = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
      const lastDayNum = new Date(prevYear, prevMonth, 0).getDate();
      startDateStr = `${pStr}-01`;
      endDateStr = `${pStr}-${String(lastDayNum).padStart(2, '0')}`;
    } else if (preset === 'custom' || date_from || date_to) {
      if (date_from) startDateStr = date_from;
      if (date_to) endDateStr = date_to;
    }

    const statusFilterList = status && status !== 'all' ? status.split(',') : null;

    const filteredOrders = allOrders.filter((o) => {
      if (o.is_quote) return false;
      const dt = o.created_at.toISOString().substring(0, 10);
      if (startDateStr && dt < startDateStr) return false;
      if (endDateStr && dt > endDateStr) return false;
      if (statusFilterList && !statusFilterList.includes(o.status)) return false;
      return true;
    });

    const total_orders = filteredOrders.length;
    const paidOrders = filteredOrders.filter((o) => o.status !== 'cancelado');
    const cancelledOrders = filteredOrders.filter((o) => o.status === 'cancelado');
    const total_delivered = paidOrders.length;
    const total_cancelled = cancelledOrders.length;
    const cancellation_rate = total_orders > 0 ? Math.round((total_cancelled / total_orders) * 1000) / 10 : 0;

    const total_revenue = Math.round(paidOrders.reduce((sum, o) => sum + (o.total_usd || 0), 0) * 100) / 100;
    const delivery_revenue = Math.round(paidOrders.reduce((sum, o) => sum + (o.delivery_fee || 0), 0) * 100) / 100;
    const product_revenue = Math.round((total_revenue - delivery_revenue) * 100) / 100;

    const avg_ticket = total_delivered > 0 ? Math.round((total_revenue / total_delivered) * 100) / 100 : 0;

    const pickupOrders = paidOrders.filter((o) => o.order_type === 'pickup');
    const tiendaOrders = paidOrders.filter((o) => o.order_type === 'tienda');
    const deliveryOrders = paidOrders.filter((o) => o.order_type !== 'pickup' && o.order_type !== 'tienda');
    const pickup_count = pickupOrders.length;
    const tienda_count = tiendaOrders.length;
    const delivery_count = deliveryOrders.length;
    const pickup_revenue = Math.round(pickupOrders.reduce((sum, o) => sum + (o.total_usd || 0), 0) * 100) / 100;
    const tienda_revenue = Math.round(tiendaOrders.reduce((sum, o) => sum + (o.total_usd || 0), 0) * 100) / 100;
    const delivery_orders_revenue = Math.round(deliveryOrders.reduce((sum, o) => sum + (o.total_usd || 0), 0) * 100) / 100;

    // Customer counts and repeat calculation (> 1 paid order)
    const phoneMap = new Map<string, string>();
    allCustomers.forEach((c) => {
      const pDigits = (c.phone || '').replace(/[^0-9]/g, '');
      if (pDigits.length >= 7) {
        phoneMap.set(pDigits.slice(-10), c.id);
      }
    });

    const countsMap = new Map<string, number>();
    const allPaidOrders = allOrders.filter((o) => o.status !== 'cancelado' && !o.is_quote);
    allPaidOrders.forEach((o) => {
      let cId = o.customer_id;
      if (!cId && o.customer_phone) {
        const oDigits = o.customer_phone.replace(/[^0-9]/g, '');
        if (oDigits.length >= 7) cId = phoneMap.get(oDigits.slice(-10)) || null;
      }
      if (cId) {
        countsMap.set(cId, (countsMap.get(cId) || 0) + 1);
      }
    });

    const unique_customers = allCustomers.length || 1;
    let customers_1_order = 0;
    let customers_2_orders = 0;
    let customers_3_orders = 0;
    let customers_4_plus_orders = 0;

    allCustomers.forEach((c) => {
      const cnt = countsMap.get(c.id) || 0;
      if (cnt === 1) customers_1_order++;
      else if (cnt === 2) customers_2_orders++;
      else if (cnt === 3) customers_3_orders++;
      else if (cnt >= 4) customers_4_plus_orders++;
    });

    const repeat_customers = customers_2_orders + customers_3_orders + customers_4_plus_orders;
    const new_customers = customers_1_order;
    const retention_rate = unique_customers > 0 ? Math.round((repeat_customers / unique_customers) * 100) : 0;
    const pct_1_order = unique_customers > 0 ? Math.round((customers_1_order / unique_customers) * 100) : 0;
    const pct_2_orders = unique_customers > 0 ? Math.round((customers_2_orders / unique_customers) * 100) : 0;
    const pct_3_orders = unique_customers > 0 ? Math.round((customers_3_orders / unique_customers) * 100) : 0;
    const pct_4_plus_orders = unique_customers > 0 ? Math.round((customers_4_plus_orders / unique_customers) * 100) : 0;

    // Daily Chart
    const dailyMap = new Map<string, { revenue: number; orders: number }>();
    paidOrders.forEach((o) => {
      const dStr = o.created_at.toISOString().substring(0, 10);
      const cur = dailyMap.get(dStr) || { revenue: 0, orders: 0 };
      cur.revenue += o.total_usd || 0;
      cur.orders += 1;
      dailyMap.set(dStr, cur);
    });

    const daily_chart: Array<{ date: string; revenue: number; orders: number }> = [];
    const validStart = startDateStr && !isNaN(new Date(`${startDateStr}T00:00:00.000Z`).getTime());
    const validEnd = endDateStr && !isNaN(new Date(`${endDateStr}T00:00:00.000Z`).getTime());
    if (validStart && validEnd) {
      const curDate = new Date(`${startDateStr}T00:00:00.000Z`);
      const endDate = new Date(`${endDateStr}T00:00:00.000Z`);
      while (curDate <= endDate) {
        const dStr = curDate.toISOString().substring(0, 10);
        const entry = dailyMap.get(dStr) || { revenue: 0, orders: 0 };
        daily_chart.push({
          date: dStr,
          revenue: Math.round(entry.revenue * 100) / 100,
          orders: entry.orders,
        });
        curDate.setDate(curDate.getDate() + 1);
      }
    } else {
      const sortedDates = Array.from(dailyMap.keys()).sort();
      sortedDates.forEach((dStr) => {
        const entry = dailyMap.get(dStr)!;
        daily_chart.push({
          date: dStr,
          revenue: Math.round(entry.revenue * 100) / 100,
          orders: entry.orders,
        });
      });
    }

    // Peak Hours
    const hourCounts: Record<number, number> = {};
    for (let h = 0; h < 24; h++) hourCounts[h] = 0;
    filteredOrders.forEach((o) => {
      const h = new Date(o.created_at).getHours();
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    });

    const peak_hours = Object.entries(hourCounts).map(([hStr, count]) => {
      const hNum = parseInt(hStr, 10);
      return { hour: `${String(hNum).padStart(2, '0')}:00`, orders: count };
    });

    let maxHour = 19;
    let maxHourOrders = 0;
    Object.entries(hourCounts).forEach(([hStr, count]) => {
      if (count > maxHourOrders) {
        maxHourOrders = count;
        maxHour = parseInt(hStr, 10);
      }
    });
    const peak_hour = `${String(maxHour).padStart(2, '0')}:00 (${maxHourOrders} pedidos)`;

    // Status Breakdown
    const statusCounts: Record<string, number> = {};
    filteredOrders.forEach((o) => {
      statusCounts[o.status] = (statusCounts[o.status] || 0) + 1;
    });

    const statusConfig: Record<string, { label: string; color: string }> = {
      entregado: { label: 'Entregados', color: '#3F634A' },
      en_camino: { label: 'En Camino', color: '#4285F4' },
      preparando: { label: 'En Preparación', color: '#C27A29' },
      pendiente: { label: 'Pendientes', color: '#501122' },
      sin_pagar: { label: 'Sin Pagar', color: '#C27A29' },
      cancelado: { label: 'Cancelados', color: '#dc2626' },
    };

    const status_breakdown = Object.entries(statusCounts).map(([st, count]) => {
      const cfg = statusConfig[st] || { label: st, color: '#501122' };
      return {
        status: st,
        label: cfg.label,
        count,
        percentage: total_orders > 0 ? Math.round((count / total_orders) * 100) : 0,
        color: cfg.color,
      };
    });

    // Top Flavors
    const flavorStatsMap = new Map<string, { quantity: number; revenue: number }>();
    let totalFlavorQty = 0;
    paidOrders.forEach((o) => {
      o.items.forEach((it) => {
        const name = it.flavor_name || 'Sin sabor';
        const cur = flavorStatsMap.get(name) || { quantity: 0, revenue: 0 };
        cur.quantity += it.quantity;
        cur.revenue += it.quantity * it.price_usd;
        totalFlavorQty += it.quantity;
        flavorStatsMap.set(name, cur);
      });
    });

    const flavorColors = ['#501122', '#3F634A', '#C27A29', '#8B4513', '#E11D48', '#4285F4', '#9333EA'];
    const top_flavors = Array.from(flavorStatsMap.entries())
      .map(([name, stat], idx) => ({
        name,
        quantity: stat.quantity,
        revenue: Math.round(stat.revenue * 100) / 100,
        percentage: totalFlavorQty > 0 ? Math.round((stat.quantity / totalFlavorQty) * 100) : 0,
        color: flavorColors[idx % flavorColors.length],
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 10);

    // Top Customers
    const customerSpentMap = new Map<string, { id: string; name: string; phone: string; total_orders: number; total_spent: number }>();
    paidOrders.forEach((o) => {
      const name = o.customer_name || 'Cliente';
      const cur = customerSpentMap.get(name) || {
        id: o.customer_id || name,
        name,
        phone: o.customer_phone || '',
        total_orders: 0,
        total_spent: 0,
      };
      cur.total_orders += 1;
      cur.total_spent += o.total_usd || 0;
      customerSpentMap.set(name, cur);
    });

    const top_customers = Array.from(customerSpentMap.values())
      .map((c) => ({ ...c, total_spent: Math.round(c.total_spent * 100) / 100 }))
      .sort((a, b) => b.total_spent - a.total_spent)
      .slice(0, 5);

    // Delivery Ranking
    const driverStatsMap = new Map<string, { id: string; name: string; delivered: number; earnings: number; revenue: number; km_delivered: number; avg_mins: number }>();
    dbDrivers.forEach((d) => {
      driverStatsMap.set(d.id, { id: d.id, name: d.name, delivered: 0, earnings: 0, revenue: 0, km_delivered: 0, avg_mins: 25 });
    });

    paidOrders.forEach((o) => {
      if (o.order_type === 'pickup' || o.order_type === 'tienda') return;
      let dKey = o.delivery_id;
      if (!dKey && o.delivery_name) {
        const match = dbDrivers.find((d) => d.name.toLowerCase() === o.delivery_name!.toLowerCase());
        if (match) dKey = match.id;
      }
      if (dKey && driverStatsMap.has(dKey)) {
        const st = driverStatsMap.get(dKey)!;
        st.delivered += 1;
        st.earnings += o.delivery_fee || 0;
        st.revenue += o.total_usd || 0;
        st.km_delivered += 3.5;
      } else if (o.delivery_name) {
        const dKey = o.delivery_name;
        if (!driverStatsMap.has(dKey)) {
          driverStatsMap.set(dKey, { id: dKey, name: o.delivery_name, delivered: 0, earnings: 0, revenue: 0, km_delivered: 0, avg_mins: 25 });
        }
        const st = driverStatsMap.get(dKey)!;
        st.delivered += 1;
        st.earnings += o.delivery_fee || 0;
        st.revenue += o.total_usd || 0;
        st.km_delivered += 3.5;
      }
    });

    const delivery_ranking = Array.from(driverStatsMap.values())
      .map((d) => ({
        ...d,
        earnings: Math.round(d.earnings * 100) / 100,
        revenue: Math.round(d.revenue * 100) / 100,
        km_delivered: Math.round(d.km_delivered * 10) / 10,
      }))
      .filter((d) => d.delivered > 0)
      .sort((a, b) => b.delivered - a.delivered);

    // Quote conversion
    const allQuotesAndConverted = await prisma.order.findMany({
      where: {
        OR: [
          { is_quote: true },
          {
            is_quote: false,
            quote_description: { not: null },
          },
        ],
      },
      select: {
        id: true,
        is_quote: true,
        status: true,
        total_usd: true,
        quote_description: true,
      },
    });

    const pending_quotes = allQuotesAndConverted.filter((o) => o.is_quote).length;
    const converted_orders = allQuotesAndConverted.filter(
      (o) => !o.is_quote && o.quote_description && o.quote_description.trim() !== ''
    ).length;
    const total_quotes = pending_quotes + converted_orders;
    const conversion_rate = total_quotes > 0 ? Math.round((converted_orders / total_quotes) * 100) : 0;
    const revenue_from_quotes = allQuotesAndConverted
      .filter((o) => !o.is_quote && o.quote_description && o.quote_description.trim() !== '' && o.status === 'entregado')
      .reduce((sum, o) => sum + o.total_usd, 0);

    const quote_funnel = {
      total_quotes,
      converted_orders,
      conversion_rate,
      revenue_from_quotes,
      pending_quotes,
      avg_conversion_time_hours: 1.5,
    };

    // Product matrix
    const product_matrix = top_flavors.map((f) => ({
      name: f.name,
      tag: f.percentage > 30 ? 'Estrella 🌟' : f.percentage > 15 ? 'High Margin 💎' : 'Rotación Rápida ⚡',
      units: f.quantity,
      price: f.quantity > 0 ? Math.round((f.revenue / f.quantity) * 100) / 100 : 10,
      revenue: f.revenue,
      margin_pct: 70,
      trend: '+15%',
    }));

    // Customer cohorts
    const customer_cohorts = {
      first_time_count: new_customers,
      repeat_count: repeat_customers,
      retention_rate: retention_rate,
      avg_days_between_orders: 6,
      avg_customer_ltv: unique_customers > 0 ? Math.round((total_revenue / unique_customers) * 100) / 100 : 0,
      vip_customers_count: allCustomers.filter((c) => (countsMap.get(c.id) || 0) >= 3).length,
    };

    res.json({
      summary: {
        total_revenue,
        product_revenue,
        delivery_revenue,
        total_orders,
        total_delivered,
        total_cancelled,
        cancellation_rate,
        avg_ticket,
        unique_customers,
        new_customers,
        repeat_customers,
        retention_rate,
        customers_1_order,
        customers_2_orders,
        customers_3_orders,
        customers_4_plus_orders,
        pct_1_order,
        pct_2_orders,
        pct_3_orders,
        pct_4_plus_orders,
        pickup_count,
        tienda_count,
        delivery_count,
        pickup_revenue,
        tienda_revenue,
        delivery_orders_revenue,
      },
      peak_hour,
      daily_chart,
      peak_hours,
      status_breakdown,
      top_flavors,
      top_customers,
      delivery_ranking,
      quote_funnel,
      product_matrix,
      customer_cohorts,
    });
  } catch (err: any) {
    console.error('Error generating report:', err);
    res.status(500).json({ detail: 'Error al generar reporte' });
  }
});

app.get('/api/dashboard/export', requireRoles('admin'), async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="reporte_lubos.csv"');
  res.send('Numero,Fecha,Cliente,Total USD\n');
});

function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

app.post('/api/dashboard/import-csv', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const { csvText } = req.body || {};
    if (!csvText || typeof csvText !== 'string') {
      res.status(400).json({ detail: 'Se requiere el contenido del archivo CSV' });
      return;
    }

    const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) {
      res.status(400).json({ detail: 'El archivo CSV está vacío' });
      return;
    }

    // Check for BCV rate
    for (const l of lines) {
      if (l.toLowerCase().includes('tasa bcv:')) {
        const match = l.match(/tasa\s+bcv:\s*([0-9.]+)/i);
        if (match && match[1]) {
          const rate = parseFloat(match[1]);
          if (!isNaN(rate) && rate > 0) {
            await prisma.appSettings.upsert({
              where: { key: 'app_settings' },
              update: { exchange_rate_ves: rate },
              create: { key: 'app_settings', exchange_rate_ves: rate },
            }).catch(() => {});
          }
        }
      }
    }

    // Find table header row
    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseCsvRow(lines[i]);
      const joined = parsed.join(',').toLowerCase();
      if (joined.includes('numero') && (joined.includes('fecha') || joined.includes('cliente'))) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) {
      res.status(400).json({ detail: 'No se encontró el encabezado (Numero,Fecha,Cliente,...) en el CSV' });
      return;
    }

    // Fetch existing db records for reference
    const allCustomers = await prisma.customer.findMany();
    const allFlavors = await prisma.flavor.findMany();
    const allDrivers = await prisma.user.findMany({ where: { role: { in: ['repartidor', 'delivery'] } } });

    // Track phone numbers and names -> customer
    const customerPhoneMap = new Map<string, typeof allCustomers[0]>();
    const customerNameMap = new Map<string, typeof allCustomers[0]>();

    allCustomers.forEach((c) => {
      customerNameMap.set(c.name.toLowerCase().trim(), c);
      const digits = (c.phone || '').replace(/[^0-9]/g, '');
      if (digits.length >= 7) {
        customerPhoneMap.set(digits.slice(-10), c);
      }
    });

    const newlyCreatedCustomers: { id: string; name: string; phone: string; gender: string | null }[] = [];
    let importedOrdersCount = 0;

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line || line.startsWith('RESUMEN') || line.startsWith('Total pedidos')) {
        break; // Reached summary section
      }

      const row = parseCsvRow(line);
      if (row.length < 5) continue;

      const orderNumber = row[0]?.trim();
      const fecha = row[1]?.trim();
      const hora = row[2]?.trim();
      const cliente = row[3]?.trim();
      const telefono = row[4]?.trim();
      const saboresStr = row[5]?.trim();
      const repartidor = row[6]?.trim();
      const estado = row[7]?.trim();
      const totalUsd = parseFloat(row[8]) || 0;
      const totalVes = parseFloat(row[9]) || 0;
      const deliveryUsd = parseFloat(row[10]) || 0;
      const notas = row[11]?.trim() || '';

      if (!orderNumber || !fecha) continue;

      // Handle Customer
      let customerId: string | null = null;
      let customerName = cliente || '(Sin cliente)';
      let customerPhone: string | null = telefono || null;
      let customerGender: string | null = null;

      const isAnon = !cliente || cliente === '(Cotizacion sin cliente)' || cliente === '(Sin cliente)';

      if (!isAnon) {
        const phoneDigits = (telefono || '').replace(/[^0-9]/g, '');
        let existingCust: typeof allCustomers[0] | undefined;

        if (phoneDigits.length >= 7) {
          existingCust = customerPhoneMap.get(phoneDigits.slice(-10));
        }
        if (!existingCust && cliente) {
          existingCust = customerNameMap.get(cliente.toLowerCase().trim());
        }

        if (existingCust) {
          customerId = existingCust.id;
          customerName = existingCust.name;
          customerPhone = existingCust.phone;
          customerGender = existingCust.gender || null;
        } else {
          // Create new customer
          const createdCust = await prisma.customer.create({
            data: {
              name: cliente,
              phone: telefono || '',
              gender: null,
            },
          });
          customerId = createdCust.id;
          customerName = createdCust.name;
          customerPhone = createdCust.phone;
          customerGender = null;

          // Register in lookup maps
          customerNameMap.set(createdCust.name.toLowerCase().trim(), createdCust);
          if (phoneDigits.length >= 7) {
            customerPhoneMap.set(phoneDigits.slice(-10), createdCust);
          }
          allCustomers.push(createdCust);

          newlyCreatedCustomers.push({
            id: createdCust.id,
            name: createdCust.name,
            phone: createdCust.phone,
            gender: null,
          });
        }
      }

      // Handle Delivery / Repartidor
      const rep = (repartidor || '').trim();
      let orderType = 'delivery';
      let deliveryName: string | null = rep;
      let deliveryId: string | null = null;

      if (!rep || rep.toLowerCase().includes('pickup') || rep.toLowerCase().includes('tienda') || rep.toLowerCase().includes('cotizacion')) {
        orderType = 'pickup';
        deliveryName = rep || 'Pickup en tienda';
      } else {
        const matchDriver = allDrivers.find((d) =>
          d.name.toLowerCase().trim() === rep.toLowerCase() ||
          d.name.toLowerCase().includes(rep.toLowerCase()) ||
          rep.toLowerCase().includes(d.name.toLowerCase())
        );
        if (matchDriver) {
          deliveryId = matchDriver.id;
          deliveryName = matchDriver.name;
        }
      }

      // Handle Status & Dates
      const est = (estado || '').trim().toLowerCase();
      let status = 'pendiente';
      let isQuote = false;

      if (est === 'cotizacion' || est.includes('cotiza')) {
        status = 'cotizacion';
        isQuote = true;
      } else if (est === 'entregado') {
        status = 'entregado';
      } else if (est === 'cancelado') {
        status = 'cancelado';
      } else if (est === 'pendiente') {
        status = 'pendiente';
      } else {
        status = est || 'pendiente';
      }

      let orderCreatedAt = new Date();
      if (fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        const timeStr = hora && /^\d{1,2}:\d{2}$/.test(hora) ? hora : '12:00';
        const d = new Date(`${fecha}T${timeStr.length === 4 ? '0' + timeStr : timeStr}:00.000Z`);
        if (!isNaN(d.getTime())) {
          orderCreatedAt = d;
        }
      }

      // Handle Items / Sabores
      const itemParts = (saboresStr || '').split(',').map((s) => s.trim()).filter(Boolean);
      const parsedItems: { flavorName: string; quantity: number; flavorId: string; priceUsd: number }[] = [];

      let totalItemQty = 0;
      const tempItems: { flavorName: string; quantity: number }[] = [];

      for (const part of itemParts) {
        const m = part.match(/^(.*?)\s*x\s*(\d+)$/i);
        if (m) {
          const fn = m[1].trim();
          const q = parseInt(m[2], 10) || 1;
          tempItems.push({ flavorName: fn, quantity: q });
          totalItemQty += q;
        } else if (part) {
          tempItems.push({ flavorName: part, quantity: 1 });
          totalItemQty += 1;
        }
      }

      const itemsTotalCalculated = Math.max(0, totalUsd - deliveryUsd);

      for (const ti of tempItems) {
        let matchedFlavor = allFlavors.find((f) => f.name.toLowerCase().trim() === ti.flavorName.toLowerCase());
        if (!matchedFlavor) {
          matchedFlavor = allFlavors.find((f) =>
            f.name.toLowerCase().includes(ti.flavorName.toLowerCase()) ||
            ti.flavorName.toLowerCase().includes(f.name.toLowerCase())
          );
        }

        const flavorId = matchedFlavor ? matchedFlavor.id : (allFlavors[0]?.id || 'manual');
        const flavorName = matchedFlavor ? matchedFlavor.name : ti.flavorName;
        const itemPrice = matchedFlavor ? matchedFlavor.price_usd : Math.round((itemsTotalCalculated / (totalItemQty || 1)) * 100) / 100;

        parsedItems.push({
          flavorName,
          quantity: ti.quantity,
          flavorId,
          priceUsd: itemPrice,
        });
      }

      // Address
      const deliveryAddress = orderType === 'pickup' ? 'Pickup en tienda' : (notas || 'Delivery');

      // Check if order already exists in database by order_number
      const existingOrder = await prisma.order.findFirst({
        where: { order_number: orderNumber },
      });

      const orderData = {
        order_number: orderNumber,
        customer_id: customerId,
        customer_name: customerName,
        customer_phone: customerPhone,
        customer_gender: customerGender,
        order_type: orderType,
        delivery_address: deliveryAddress,
        delivery_id: deliveryId,
        delivery_name: deliveryName,
        delivery_fee: deliveryUsd,
        status: status,
        is_quote: isQuote,
        total_usd: totalUsd,
        items_total: itemsTotalCalculated,
        notes: notas || null,
        created_at: orderCreatedAt,
        delivered_at: status === 'entregado' ? orderCreatedAt : null,
      };

      if (existingOrder) {
        await prisma.orderItem.deleteMany({ where: { order_id: existingOrder.id } });
        await prisma.order.update({
          where: { id: existingOrder.id },
          data: {
            ...orderData,
            items: {
              create: parsedItems.map((pi) => ({
                flavor_id: pi.flavorId,
                flavor_name: pi.flavorName,
                quantity: pi.quantity,
                price_usd: pi.priceUsd,
              })),
            },
          },
        });
      } else {
        await prisma.order.create({
          data: {
            ...orderData,
            items: {
              create: parsedItems.map((pi) => ({
                flavor_id: pi.flavorId,
                flavor_name: pi.flavorName,
                quantity: pi.quantity,
                price_usd: pi.priceUsd,
              })),
            },
          },
        });
      }

      importedOrdersCount++;
    }

    // Recalculate order_count for all customers
    const deliveredOrders = await prisma.order.findMany({
      where: { status: { not: 'cancelado' }, is_quote: false },
      select: { customer_id: true },
    });
    const countsMap = new Map<string, number>();
    deliveredOrders.forEach((o) => {
      if (o.customer_id) countsMap.set(o.customer_id, (countsMap.get(o.customer_id) || 0) + 1);
    });

    for (const c of allCustomers) {
      const cnt = countsMap.get(c.id) || 0;
      await prisma.customer.update({
        where: { id: c.id },
        data: { order_count: cnt },
      }).catch(() => {});
    }

    broadcastEvent('customers_changed');
    broadcastEvent('orders_changed');

    res.json({
      success: true,
      importedCount: importedOrdersCount,
      newCustomers: newlyCreatedCustomers,
    });
  } catch (err: any) {
    console.error('Error importing CSV:', err);
    res.status(500).json({ detail: 'Error al procesar la importación CSV: ' + (err?.message || 'Error interno') });
  }
});

// ── 8. DELIVERY & ZONES ──

// ── TRACCAR CLIENT WEBHOOK ENDPOINT (GET & POST) ──
const handleTraccarPing = async (req: Request, res: Response) => {
  try {
    // 1. Extract params from URL search string
    const urlParamsObj: Record<string, string> = {};
    try {
      const fullUrl = 'http://localhost' + (req.originalUrl || req.url || '');
      const parsedUrl = new URL(fullUrl);
      parsedUrl.searchParams.forEach((val, key) => {
        urlParamsObj[key] = val;
      });
    } catch {}

    // 2. Extract params from body
    let bodyParams: Record<string, any> = {};
    if (typeof req.body === 'object' && req.body !== null) {
      bodyParams = req.body;
    } else if (typeof req.body === 'string') {
      try {
        bodyParams = JSON.parse(req.body);
      } catch {
        const searchParams = new URLSearchParams(req.body);
        searchParams.forEach((val, key) => { bodyParams[key] = val; });
      }
    }

    // Helper to search value across all param sources (case-insensitive keys)
    const getValue = (keys: string[]): string | undefined => {
      for (const k of keys) {
        for (const source of [urlParamsObj, req.query, bodyParams]) {
          if (!source) continue;
          for (const [sKey, sVal] of Object.entries(source)) {
            if (sKey.toLowerCase() === k.toLowerCase() && sVal !== undefined && sVal !== null && String(sVal).trim() !== '') {
              return String(sVal).trim();
            }
          }
        }
      }
      return undefined;
    };

    const parseNum = (valStr?: string): number => {
      if (!valStr) return NaN;
      // Handle commas in Spanish decimal format e.g. "10,245523" -> "10.245523"
      const clean = String(valStr).replace(',', '.');
      return parseFloat(clean);
    };

    const rawDeviceId = getValue(['id', 'deviceid', 'deviceId', 'device_id', 'user', 'username']) || 'Víctor';
    const latStr = getValue(['lat', 'latitude', 'location_lat']);
    const lonStr = getValue(['lon', 'lng', 'longitude', 'location_lng']);
    const speedStr = getValue(['speed', 'spd']);
    const bearingStr = getValue(['bearing', 'heading', 'hdg']);

    const lat = parseNum(latStr);
    const lng = parseNum(lonStr);
    const speed = parseNum(speedStr) || 0;
    const bearing = parseNum(bearingStr) || 0;

    // If no coordinates provided in heartbeat, log & confirm server availability with HTTP 200
    if (isNaN(lat) || isNaN(lng)) {
      console.log('[TRACCAR GPS HEARTBEAT] Handshake ping received:', { rawDeviceId, url: req.originalUrl });
      res.status(200).send('OK');
      return;
    }

    // Accent-insensitive normalization (e.g. "Víctor" -> "victor")
    const norm = (str: string) =>
      str ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim() : '';

    const cleanDeviceId = norm(rawDeviceId);

    // Fetch all users to match driver by name or username or ID
    const allUsers = await prisma.user.findMany();
    let driver = allUsers.find(u => {
      const uName = norm(u.name || '');
      const uUser = norm(u.username || '');
      const uId = norm(u.id || '');
      return (
        (uName && (uName === cleanDeviceId || uName.includes(cleanDeviceId) || cleanDeviceId.includes(uName))) ||
        (uUser && (uUser === cleanDeviceId || uUser.includes(cleanDeviceId) || cleanDeviceId.includes(uUser))) ||
        (uId && uId === cleanDeviceId)
      );
    });

    // Fallback 1: user with role 'delivery'
    if (!driver) {
      driver = allUsers.find(u => u.role === 'delivery');
    }

    // Fallback 2: first user in database
    if (!driver) {
      driver = allUsers[0];
    }

    if (driver) {
      // 1. Parse incoming timestamp
      const timestampStr = getValue(['timestamp', 'time', 'deviceTime', 'fixTime']);
      let fixTime = new Date();
      if (timestampStr) {
        if (/^\d+$/.test(timestampStr)) {
          const num = parseInt(timestampStr, 10);
          if (num < 10000000000) {
            fixTime = new Date(num * 1000);
          } else {
            fixTime = new Date(num);
          }
        } else {
          const parsed = Date.parse(timestampStr);
          if (!isNaN(parsed)) {
            fixTime = new Date(parsed);
          } else {
            const match = timestampStr.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
            if (match) {
              const [_, y, m, d, h, min, s] = match;
              fixTime = new Date(Date.UTC(
                parseInt(y, 10),
                parseInt(m, 10) - 1,
                parseInt(d, 10),
                parseInt(h, 10),
                parseInt(min, 10),
                parseInt(s, 10)
              ));
            }
          }
        }
      }

      // 2. Out-of-order queue protection: check if DB already has a newer location timestamp
      if (driver.location_updated_at) {
        const dbTime = new Date(driver.location_updated_at);
        if (dbTime.getTime() >= fixTime.getTime()) {
          console.log(`[TRACCAR GPS SKIP] Stale queued position skipped for ${driver.name}. Incoming (${fixTime.toISOString()}) is older/equal to DB (${dbTime.toISOString()})`);
          res.status(200).send('OK');
          return;
        }
      }

      await prisma.user.update({
        where: { id: driver.id },
        data: {
          location_lat: lat,
          location_lng: lng,
          location_updated_at: fixTime,
        },
      });

      broadcastEvent('location_update', {
        driver_id: driver.id,
        name: driver.name,
        username: driver.username,
        color: driver.color || null,
        photo_url: driver.photo_data_url || null,
        lat,
        lng,
        speed,
        bearing,
        updated_at: fixTime.toISOString(),
      });

      console.log(`[TRACCAR GPS SUCCESS] Position updated for ${driver.name} (${rawDeviceId}): ${lat}, ${lng} at ${fixTime.toISOString()}`);
    } else {
      console.warn(`[TRACCAR GPS] Received location for unknown deviceId: ${rawDeviceId}`);
    }

    res.status(200).send('OK');
  } catch (err: any) {
    console.error('Error in Traccar handler:', err);
    res.status(200).send('OK');
  }
};

app.get('/api/traccar', handleTraccarPing);
app.post('/api/traccar', handleTraccarPing);

app.get('/api/delivery/locations', requireRoles('admin', 'vendedor', 'delivery'), async (req: Request, res: Response) => {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const active = await prisma.user.findMany({
      where: {
        location_lat: { not: null },
        location_lng: { not: null },
        location_updated_at: { gte: fiveMinutesAgo },
      },
    });
    const result = active.map((u) => ({
      delivery_id: u.id,
      name: u.name || u.username,
      username: u.username,
      photo_url: u.photo_data_url || null,
      color: u.color || null,
      lat: u.location_lat!,
      lng: u.location_lng!,
      updated_at: u.location_updated_at ? u.location_updated_at.toISOString() : new Date().toISOString(),
    }));
    res.json(result);
  } catch (err: any) {
    console.error('Error getting delivery locations:', err);
    res.status(500).json({ detail: 'Error al obtener ubicaciones de repartidores' });
  }
});

app.get('/api/delivery/stats', requireRoles('delivery'), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const pct = await getDeliveryDriverPct();
    const factor = pct / 100;
    const delivered = await prisma.order.findMany({
      where: { delivery_id: user.user_id, status: 'entregado' },
    });
    const totalEarn = delivered.reduce((sum, o) => sum + ((o.delivery_fee || 0) * factor), 0);
    const revenue = Math.round(totalEarn * 100) / 100;

    res.json({
      today: { delivered: delivered.length, revenue, pending: 0 },
      week: { daily: [], total_delivered: delivered.length, total_revenue: revenue },
      month: { delivered: delivered.length, revenue },
      all_time: { delivered: delivered.length, revenue },
      driver_pct: pct,
    });
  } catch (err: any) {
    console.error('Error getting delivery stats:', err);
    res.status(500).json({ detail: 'Error al obtener estadísticas del repartidor' });
  }
});

app.get('/api/zones', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    const zones = await prisma.deliveryZone.findMany({
      orderBy: { created_at: 'asc' },
    });
    res.json(zones.map(formatDeliveryZone));
  } catch (err: any) {
    console.error('Error getting zones:', err);
    res.status(500).json({ detail: 'Error al obtener zonas' });
  }
});

app.post('/api/zones', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { name, polygon, delivery_cost_usd, color } = req.body || {};
    if (!name || !Array.isArray(polygon) || polygon.length < 3) {
      res.status(400).json({ detail: 'El polígono requiere al menos 3 puntos' });
      return;
    }
    const newZone = await prisma.deliveryZone.create({
      data: {
        id: uuidv4(),
        name,
        polygon,
        delivery_cost_usd: parseFloat(delivery_cost_usd || 0),
        color: color || '#501122',
      },
    });
    res.json(formatDeliveryZone(newZone));
  } catch (err: any) {
    console.error('Error creating zone:', err);
    res.status(500).json({ detail: 'Error al crear zona' });
  }
});

app.put('/api/zones/:zone_id', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { zone_id } = req.params;
    const existing = await prisma.deliveryZone.findUnique({ where: { id: zone_id } });
    if (!existing) {
      res.status(404).json({ detail: 'Zona no encontrada' });
      return;
    }
    const { name, polygon, delivery_cost_usd, color } = req.body || {};
    const updated = await prisma.deliveryZone.update({
      where: { id: zone_id },
      data: {
        ...(name !== undefined && { name }),
        ...(polygon !== undefined && { polygon }),
        ...(delivery_cost_usd !== undefined && { delivery_cost_usd: parseFloat(delivery_cost_usd) }),
        ...(color !== undefined && { color }),
      },
    });
    res.json(formatDeliveryZone(updated));
  } catch (err: any) {
    console.error('Error updating zone:', err);
    res.status(500).json({ detail: 'Error al actualizar zona' });
  }
});

app.delete('/api/zones/:zone_id', requireRoles('admin'), async (req: Request, res: Response) => {
  try {
    const { zone_id } = req.params;
    const existing = await prisma.deliveryZone.findUnique({ where: { id: zone_id } });
    if (!existing) {
      res.status(404).json({ detail: 'Zona no encontrada' });
      return;
    }
    await prisma.deliveryZone.delete({ where: { id: zone_id } });
    res.json({ message: 'Zona eliminada' });
  } catch (err: any) {
    console.error('Error deleting zone:', err);
    res.status(500).json({ detail: 'Error al eliminar zona' });
  }
});

app.post('/api/zones/check', requireRoles('admin', 'vendedor'), async (req: Request, res: Response) => {
  try {
    let { lat, lng, url, mode } = req.body || {};
    if ((lat == null || lng == null) && url) {
      const coords = parseCoordsFromUrl(url);
      if (coords) [lat, lng] = coords;
    }
    if (lat == null || lng == null) {
      res.json({ matched: false, reason: 'no_coords' });
      return;
    }

    const zonesRaw = await prisma.deliveryZone.findMany();
    const zones = zonesRaw.map(formatDeliveryZone);
    const matchedZone = zones.find((z) => pointInPolygon(lat, lng, z.polygon));

    const settings = await prisma.appSettings.findUnique({ where: { key: 'app_settings' } });
    const cpLat = settings?.central_point_lat;
    const cpLng = settings?.central_point_lng;

    const response: any = { lat, lng };

    if (cpLat != null && cpLng != null) {
      if (mode === 'linear') {
        const dist = Math.round(haversineKm(cpLat, cpLng, lat, lng) * 100) / 100;
        response.distance_km = dist;
        response.delivery_cost_usd = calcDeliveryCost(dist);
        response.distance_source = 'linear';
      } else {
        const [dist, src] = await roadDistanceKm(cpLat, cpLng, lat, lng);
        if (src === 'google') {
          const roundedDist = Math.round(dist * 100) / 100;
          response.distance_km = roundedDist;
          response.delivery_cost_usd = calcDeliveryCost(roundedDist);
          response.distance_source = 'route';
        } else {
          response.route_failed = true;
          const fallbackKm = Math.round(haversineKm(cpLat, cpLng, lat, lng) * 100) / 100;
          response.linear_distance_km = fallbackKm;
          response.linear_cost_usd = calcDeliveryCost(fallbackKm);
        }
      }
      response.central_point = { lat: cpLat, lng: cpLng };
    }

    if (matchedZone) {
      response.matched = true;
      if (!response.delivery_cost_usd) {
        response.delivery_cost_usd = matchedZone.delivery_cost_usd;
      }
      response.zone = {
        id: matchedZone.id,
        name: matchedZone.name,
        delivery_cost_usd: response.delivery_cost_usd,
        color: matchedZone.color,
      };
    } else {
      response.matched = false;
      response.reason = 'out_of_zone';
    }

    res.json(response);
  } catch (err: any) {
    console.error('Error checking zone:', err);
    res.status(500).json({ detail: 'Error al verificar zona' });
  }
});

// ── 9. NOTIFICATIONS & PUSH ──

app.get('/api/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const notifs = await prisma.notification.findMany({
      where: { user_id: user.user_id },
      orderBy: { created_at: 'desc' },
    });
    res.json(notifs.map(formatNotification));
  } catch (err: any) {
    console.error('Error getting notifications:', err);
    res.status(500).json({ detail: 'Error al obtener notificaciones' });
  }
});

app.patch('/api/notifications/:notif_id/read', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { notif_id } = req.params;
    const user = req.user!;
    await prisma.notification.updateMany({
      where: { id: notif_id, user_id: user.user_id },
      data: { read: true },
    });
    res.json({ message: 'ok' });
  } catch (err: any) {
    console.error('Error reading notification:', err);
    res.status(500).json({ detail: 'Error al marcar notificacion como leida' });
  }
});

app.patch('/api/notifications/read-all', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    await prisma.notification.updateMany({
      where: { user_id: user.user_id },
      data: { read: true },
    });
    res.json({ message: 'ok' });
  } catch (err: any) {
    console.error('Error reading all notifications:', err);
    res.status(500).json({ detail: 'Error al marcar todas las notificaciones' });
  }
});

app.post('/api/push/subscribe', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const sub = req.body;
    if (sub?.endpoint) {
      await prisma.pushSubscription.upsert({
        where: { endpoint: sub.endpoint },
        update: { user_id: user.user_id, subscription: sub },
        create: {
          id: uuidv4(),
          user_id: user.user_id,
          endpoint: sub.endpoint,
          subscription: sub,
        },
      });
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Error subscribing push:', err);
    res.status(500).json({ detail: 'Error al suscribir notificaciones push' });
  }
});

app.post('/api/push/unsubscribe', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const sub = req.body;
    if (sub?.endpoint) {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint: sub.endpoint },
      });
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Error unsubscribing push:', err);
    res.status(500).json({ detail: 'Error al desuscribir notificaciones push' });
  }
});

// ── GLOBAL ERROR HANDLING MIDDLEWARE ──
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('[Global Error Handler]:', err?.stack || err);
  if (!res.headersSent) {
    res.status(500).json({ detail: 'Error interno del servidor. Por favor, intente de nuevo más tarde.' });
  }
});

// ── 10. VITE / STATIC SERVING ──

async function startServer() {
  // Ensure all existing user passwords are set to '1234'
  try {
    const defaultHash = hashPassword('1234');
    await prisma.user.updateMany({
      data: { password_hash: defaultHash },
    });
    console.log('✅ Updated all user passwords to 1234');
  } catch (err) {
    console.error('Error updating passwords to 1234:', err);
  }

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
