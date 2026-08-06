import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://postgres:password@localhost:5432/postgres';
}

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

const rawPrisma = new PrismaClient();

// In-Memory Fallback Data Store (active if PostgreSQL is offline)
const memoryStore: {
  users: any[];
  customers: any[];
  flavors: any[];
  stockMovements: any[];
  orders: any[];
  orderItems: any[];
  notifications: any[];
  deliveryZones: any[];
  appSettings: any[];
  widgetSettings: any[];
  pushSubscriptions: any[];
} = {
  users: [
    {
      id: 'u-jhonny-001',
      username: 'jhonny',
      password_hash: hashPassword('jhonny123'),
      name: 'Jhonny',
      role: 'admin',
      photo_data_url: null,
      location_lat: null,
      location_lng: null,
      location_updated_at: null,
      created_at: new Date('2024-01-01'),
    },
    {
      id: 'u-ivan-002',
      username: 'ivan',
      password_hash: hashPassword('ivan123'),
      name: 'Ivan',
      role: 'vendedor',
      photo_data_url: null,
      location_lat: null,
      location_lng: null,
      location_updated_at: null,
      created_at: new Date('2024-01-01'),
    },
    {
      id: 'u-oscar-003',
      username: 'oscar',
      password_hash: hashPassword('oscar123'),
      name: 'Oscar',
      role: 'delivery',
      photo_data_url: null,
      location_lat: null,
      location_lng: null,
      location_updated_at: null,
      created_at: new Date('2024-01-01'),
    },
    {
      id: 'u-carlos-004',
      username: 'carlos',
      password_hash: hashPassword('carlos123'),
      name: 'Carlos Delivery',
      role: 'delivery',
      photo_data_url: null,
      location_lat: null,
      location_lng: null,
      location_updated_at: null,
      created_at: new Date('2024-01-01'),
    },
  ],
  customers: [
    { id: 'c-maria-01', name: 'María Rodríguez', phone: '+584121112233', gender: 'femenino', order_count: 5, created_at: new Date() },
    { id: 'c-carlos-02', name: 'Carlos Pérez', phone: '+584149998877', gender: 'masculino', order_count: 3, created_at: new Date() },
    { id: 'c-ana-03', name: 'Ana Gómez', phone: '+584245554433', gender: 'femenino', order_count: 8, created_at: new Date() },
    { id: 'c-luis-04', name: 'Luis Fernández', phone: '+584127776655', gender: 'masculino', order_count: 2, created_at: new Date() },
    { id: 'c-sofia-05', name: 'Sofía Martínez', phone: '+584163332211', gender: 'femenino', order_count: 4, created_at: new Date() },
  ],
  flavors: [
    {
      id: 'f-clasico-01',
      name: 'Clásico',
      price_usd: 10.0,
      available: true,
      stock: 25,
      stock_unlimited: false,
      image: null,
      sort_order: 0,
      created_at: new Date('2024-01-01'),
    },
    {
      id: 'f-cacao-02',
      name: 'Cacao Denso',
      price_usd: 10.0,
      available: true,
      stock: 18,
      stock_unlimited: false,
      image: null,
      sort_order: 1,
      created_at: new Date('2024-01-01'),
    },
    {
      id: 'f-pistacho-03',
      name: 'Pistacho Cream',
      price_usd: 12.0,
      available: true,
      stock: 12,
      stock_unlimited: false,
      image: null,
      sort_order: 2,
      created_at: new Date('2024-01-01'),
    },
    {
      id: 'f-nutella-04',
      name: 'Nutella Crunch',
      price_usd: 12.0,
      available: true,
      stock: 15,
      stock_unlimited: false,
      image: null,
      sort_order: 3,
      created_at: new Date('2024-01-01'),
    },
    {
      id: 'f-frutos-05',
      name: 'Frutos Rojos',
      price_usd: 11.0,
      available: true,
      stock: 10,
      stock_unlimited: false,
      image: null,
      sort_order: 4,
      created_at: new Date('2024-01-01'),
    },
  ],
  stockMovements: [],
  orders: [
    {
      id: 'ord-today-01',
      order_number: 'PED-1001',
      customer_id: 'c-maria-01',
      customer_name: 'María Rodríguez',
      customer_phone: '+584121112233',
      customer_gender: 'femenino',
      order_type: 'delivery',
      delivery_address: 'Av. Principal de Chacao, Res. Las Flores, Apto 4B',
      lat: 10.495,
      lng: -66.852,
      delivery_id: 'u-oscar-003',
      delivery_name: 'Oscar',
      delivery_fee: 2.5,
      status: 'pendiente',
      notes: 'Por favor tocar timbre duro',
      velitas: true,
      receiver_name: 'María Rodríguez',
      receiver_phone: '+584121112233',
      prepared: true,
      prepared_at: new Date(),
      prepared_by_name: 'Ivan',
      created_by: 'u-ivan-002',
      created_by_name: 'Ivan',
      total_usd: 22.5,
      items_total: 20.0,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'ord-today-02',
      order_number: 'PED-1002',
      customer_id: 'c-carlos-02',
      customer_name: 'Carlos Pérez',
      customer_phone: '+584149998877',
      customer_gender: 'masculino',
      order_type: 'delivery',
      delivery_address: 'Calle Madrid, Las Mercedes, Qta. Bella Vista',
      lat: 10.482,
      lng: -66.861,
      delivery_id: 'u-oscar-003',
      delivery_name: 'Oscar',
      delivery_fee: 3.0,
      status: 'en_camino',
      notes: 'Entregar en garita de vigilancia',
      velitas: false,
      prepared: true,
      prepared_at: new Date(),
      prepared_by_name: 'Ivan',
      created_by: 'u-jhonny-001',
      created_by_name: 'Jhonny',
      total_usd: 15.0,
      items_total: 12.0,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'ord-today-03',
      order_number: 'PED-1003',
      customer_id: 'c-ana-03',
      customer_name: 'Ana Gómez',
      customer_phone: '+584245554433',
      customer_gender: 'femenino',
      order_type: 'delivery',
      delivery_address: 'Altamira Sur, Edif. Plaza, Piso 2',
      lat: 10.498,
      lng: -66.848,
      delivery_id: 'u-carlos-004',
      delivery_name: 'Carlos Delivery',
      delivery_fee: 2.5,
      status: 'entregado',
      paid_at: new Date(),
      delivered_at: new Date(),
      prepared: true,
      prepared_at: new Date(),
      prepared_by_name: 'Ivan',
      created_by: 'u-ivan-002',
      created_by_name: 'Ivan',
      total_usd: 24.5,
      items_total: 22.0,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'ord-today-04',
      order_number: 'PED-1004',
      customer_id: 'c-luis-04',
      customer_name: 'Luis Fernández',
      customer_phone: '+584127776655',
      customer_gender: 'masculino',
      order_type: 'pickup',
      delivery_address: 'Retiro en Tienda',
      delivery_fee: 0,
      status: 'pendiente',
      notes: 'Pasa a retirar a las 5:00 PM',
      prepared: false,
      created_by: 'u-ivan-002',
      created_by_name: 'Ivan',
      total_usd: 20.0,
      items_total: 20.0,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'ord-yest-01',
      order_number: 'PED-0998',
      customer_id: 'c-sofia-05',
      customer_name: 'Sofía Martínez',
      customer_phone: '+584163332211',
      customer_gender: 'femenino',
      order_type: 'delivery',
      delivery_address: 'Los Palos Grandes, Av. Andrés Bello',
      lat: 10.499,
      lng: -66.841,
      delivery_id: 'u-oscar-003',
      delivery_name: 'Oscar',
      delivery_fee: 2.5,
      status: 'entregado',
      paid_at: new Date(Date.now() - 86400000),
      delivered_at: new Date(Date.now() - 86400000),
      prepared: true,
      created_by: 'u-jhonny-001',
      created_by_name: 'Jhonny',
      total_usd: 36.5,
      items_total: 34.0,
      created_at: new Date(Date.now() - 86400000),
      updated_at: new Date(Date.now() - 86400000),
    },
    {
      id: 'ord-prev-01',
      order_number: 'PED-0985',
      customer_id: 'c-maria-01',
      customer_name: 'María Rodríguez',
      customer_phone: '+584121112233',
      customer_gender: 'femenino',
      order_type: 'delivery',
      delivery_address: 'Chacao Calle Comercio',
      lat: 10.492,
      lng: -66.855,
      delivery_id: 'u-carlos-004',
      delivery_name: 'Carlos Delivery',
      delivery_fee: 2.5,
      status: 'entregado',
      paid_at: new Date(Date.now() - 172800000),
      delivered_at: new Date(Date.now() - 172800000),
      prepared: true,
      created_by: 'u-ivan-002',
      created_by_name: 'Ivan',
      total_usd: 22.5,
      items_total: 20.0,
      created_at: new Date(Date.now() - 172800000),
      updated_at: new Date(Date.now() - 172800000),
    },
  ],
  orderItems: [
    { id: 'item-01', order_id: 'ord-today-01', flavor_id: 'f-clasico-01', flavor_name: 'Clásico', quantity: 1, price_usd: 10.0 },
    { id: 'item-02', order_id: 'ord-today-01', flavor_id: 'f-pistacho-03', flavor_name: 'Pistacho Cream', quantity: 1, price_usd: 12.0 },
    { id: 'item-03', order_id: 'ord-today-02', flavor_id: 'f-nutella-04', flavor_name: 'Nutella Crunch', quantity: 1, price_usd: 12.0 },
    { id: 'item-04', order_id: 'ord-today-03', flavor_id: 'f-clasico-01', flavor_name: 'Clásico', quantity: 1, price_usd: 10.0 },
    { id: 'item-05', order_id: 'ord-today-03', flavor_id: 'f-frutos-05', flavor_name: 'Frutos Rojos', quantity: 1, price_usd: 11.0 },
    { id: 'item-06', order_id: 'ord-today-04', flavor_id: 'f-cacao-02', flavor_name: 'Cacao Denso', quantity: 2, price_usd: 10.0 },
    { id: 'item-07', order_id: 'ord-yest-01', flavor_id: 'f-clasico-01', flavor_name: 'Clásico', quantity: 1, price_usd: 10.0 },
    { id: 'item-08', order_id: 'ord-yest-01', flavor_id: 'f-pistacho-03', flavor_name: 'Pistacho Cream', quantity: 2, price_usd: 12.0 },
    { id: 'item-09', order_id: 'ord-prev-01', flavor_id: 'f-cacao-02', flavor_name: 'Cacao Denso', quantity: 2, price_usd: 10.0 },
  ],
  notifications: [],
  deliveryZones: [
    {
      id: 'z-centro-01',
      name: 'Zona Centro / Chacao',
      polygon: [
        [10.49, -66.86],
        [10.5, -66.86],
        [10.5, -66.84],
        [10.49, -66.84],
      ],
      delivery_cost_usd: 2.5,
      color: '#501122',
      created_at: new Date('2024-01-01'),
    },
    {
      id: 'z-mercedes-02',
      name: 'Las Mercedes / Baruta',
      polygon: [
        [10.47, -66.87],
        [10.49, -66.87],
        [10.49, -66.85],
        [10.47, -66.85],
      ],
      delivery_cost_usd: 3.0,
      color: '#3F634A',
      created_at: new Date('2024-01-01'),
    },
  ],
  appSettings: [
    {
      key: 'app_settings',
      exchange_rate_ves: 36.5,
      central_point_url: null,
      central_point_lat: null,
      central_point_lng: null,
      updated_at: new Date(),
    },
  ],
  widgetSettings: [
    {
      key: 'widget_settings',
      msg_stock_1: 'Quedan 1',
      msg_stock_2: 'Quedan 2',
      msg_stock_3: 'Quedan 3',
      msg_stock_4: 'Quedan 4',
      msg_stock_5: 'Quedan 5',
      msg_out: 'Agotados',
      updated_at: new Date(),
    },
  ],
  pushSubscriptions: [],
};

// Generic In-Memory Query Engine
function executeMemoryMethod(modelName: string, methodName: string, args: any = {}) {
  const storeKey =
    modelName === 'user'
      ? 'users'
      : modelName === 'customer'
      ? 'customers'
      : modelName === 'flavor'
      ? 'flavors'
      : modelName === 'stockMovement'
      ? 'stockMovements'
      : modelName === 'order'
      ? 'orders'
      : modelName === 'orderItem'
      ? 'orderItems'
      : modelName === 'notification'
      ? 'notifications'
      : modelName === 'deliveryZone'
      ? 'deliveryZones'
      : modelName === 'appSettings'
      ? 'appSettings'
      : modelName === 'widgetSettings'
      ? 'widgetSettings'
      : modelName === 'pushSubscription'
      ? 'pushSubscriptions'
      : '';

  const list: any[] = (memoryStore as any)[storeKey] || [];

  if (methodName === 'findMany') {
    let result = [...list];
    if (args.where) {
      result = result.filter((item) => matchesWhere(item, args.where));
    }
    if (args.orderBy) {
      const orders = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
      for (const ord of orders) {
        const field = Object.keys(ord)[0];
        const dir = ord[field];
        result.sort((a, b) => {
          if (a[field] < b[field]) return dir === 'asc' ? -1 : 1;
          if (a[field] > b[field]) return dir === 'asc' ? 1 : -1;
          return 0;
        });
      }
    }
    if (args.include?.items && modelName === 'order') {
      result = result.map((o) => ({
        ...o,
        items: memoryStore.orderItems.filter((it) => it.order_id === o.id),
      }));
    }
    return result;
  }

  if (methodName === 'findUnique' || methodName === 'findFirst') {
    let result = list.find((item) => matchesWhere(item, args.where));
    if (result && args.include?.items && modelName === 'order') {
      result = {
        ...result,
        items: memoryStore.orderItems.filter((it) => it.order_id === result.id),
      };
    }
    return result || null;
  }

  if (methodName === 'count') {
    if (args.where) {
      return list.filter((item) => matchesWhere(item, args.where)).length;
    }
    return list.length;
  }

  if (methodName === 'create') {
    const data = { ...args.data };
    if (!data.id && modelName !== 'appSettings' && modelName !== 'widgetSettings') {
      data.id = `mem-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    }
    if (!data.created_at) data.created_at = new Date();
    if (!data.updated_at) data.updated_at = new Date();

    if (modelName === 'order' && data.items?.create) {
      const itemsToCreate = data.items.create;
      delete data.items;
      list.push(data);
      for (const it of itemsToCreate) {
        memoryStore.orderItems.push({
          ...it,
          order_id: data.id,
        });
      }
      return {
        ...data,
        items: memoryStore.orderItems.filter((it) => it.order_id === data.id),
      };
    }

    list.push(data);
    return data;
  }

  if (methodName === 'update') {
    const idx = list.findIndex((item) => matchesWhere(item, args.where));
    if (idx !== -1) {
      const updated = {
        ...list[idx],
        ...args.data,
        updated_at: new Date(),
      };
      list[idx] = updated;
      if (args.include?.items && modelName === 'order') {
        return {
          ...updated,
          items: memoryStore.orderItems.filter((it) => it.order_id === updated.id),
        };
      }
      return updated;
    }
    return null;
  }

  if (methodName === 'updateMany') {
    let count = 0;
    list.forEach((item, idx) => {
      if (matchesWhere(item, args.where)) {
        list[idx] = { ...item, ...args.data, updated_at: new Date() };
        count++;
      }
    });
    return { count };
  }

  if (methodName === 'upsert') {
    const existingIdx = list.findIndex((item) => matchesWhere(item, args.where));
    if (existingIdx !== -1) {
      const updated = { ...list[existingIdx], ...args.update, updated_at: new Date() };
      list[existingIdx] = updated;
      return updated;
    } else {
      const created = { ...args.create, updated_at: new Date() };
      list.push(created);
      return created;
    }
  }

  if (methodName === 'delete') {
    const idx = list.findIndex((item) => matchesWhere(item, args.where));
    if (idx !== -1) {
      const [removed] = list.splice(idx, 1);
      if (modelName === 'order') {
        memoryStore.orderItems = memoryStore.orderItems.filter((it) => it.order_id !== removed.id);
      }
      return removed;
    }
    return null;
  }

  if (methodName === 'deleteMany') {
    let count = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      if (matchesWhere(list[i], args.where)) {
        const [removed] = list.splice(i, 1);
        if (modelName === 'order') {
          memoryStore.orderItems = memoryStore.orderItems.filter((it) => it.order_id !== removed.id);
        }
        count++;
      }
    }
    return { count };
  }

  return null;
}

function matchesWhere(item: any, where: any): boolean {
  if (!where) return true;
  for (const key of Object.keys(where)) {
    const val = where[key];
    if (key === 'NOT') {
      if (matchesWhere(item, val)) return false;
      continue;
    }
    if (val && typeof val === 'object') {
      if ('in' in val && Array.isArray(val.in)) {
        if (!val.in.includes(item[key])) return false;
      } else if ('notIn' in val && Array.isArray(val.notIn)) {
        if (val.notIn.includes(item[key])) return false;
      } else if ('not' in val) {
        if (item[key] === val.not) return false;
      } else if (key === 'username' || key === 'id') {
        if (item[key] !== val) return false;
      }
    } else {
      if (item[key] !== val) return false;
    }
  }
  return true;
}

// Transparent Prisma Proxy that attempts DB queries and falls back seamlessly if DB is offline
export const prisma: any = new Proxy(rawPrisma, {
  get(target, modelName: string) {
    if (modelName === '$connect' || modelName === '$disconnect') {
      return async () => {};
    }
    const modelObj = (target as any)[modelName];
    return new Proxy(modelObj || {}, {
      get(mTarget, methodName: string) {
        return async (...args: any[]) => {
          try {
            if (typeof mTarget[methodName] === 'function') {
              return await mTarget[methodName](...args);
            }
          } catch (err: any) {
            console.warn(`[Prisma DB Offline/Fallback] ${modelName}.${methodName}:`, err?.message || err);
            return executeMemoryMethod(modelName, methodName, args[0]);
          }
          return executeMemoryMethod(modelName, methodName, args[0]);
        };
      },
    });
  },
});

export interface User {
  id: string;
  username: string;
  password_hash: string;
  name: string;
  role: 'admin' | 'vendedor' | 'delivery' | string;
  photo_data_url?: string | null;
  location?: {
    lat: number;
    lng: number;
    updated_at: string;
  };
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  gender?: string | null;
  order_count?: number;
  created_at: string;
}

export interface Flavor {
  id: string;
  name: string;
  price_usd: number;
  available: boolean;
  stock: number;
  stock_unlimited?: boolean;
  image?: string | null;
  sort_order?: number;
  created_at: string;
}

export interface StockMovement {
  id: string;
  flavor_id: string;
  flavor_name: string;
  delta: number;
  new_stock: number;
  description: string;
  user_id: string;
  user_name: string;
  created_at: string;
}

export interface OrderItem {
  id?: string;
  flavor_id: string;
  flavor_name: string;
  quantity: number;
  price_usd: number;
}

export interface Order {
  id: string;
  order_number: string;
  customer_id?: string | null;
  customer_name: string;
  customer_phone?: string;
  customer_gender?: string | null;
  items: OrderItem[];
  order_type: 'delivery' | 'pickup' | string;
  delivery_address: string;
  lat?: number | null;
  lng?: number | null;
  delivery_id?: string | null;
  delivery_name?: string | null;
  delivery_photo_url?: string | null;
  delivery_fee: number;
  status: 'sin_pagar' | 'cotizacion' | 'pendiente' | 'en_camino' | 'entregado' | 'cancelado' | string;
  is_quote?: boolean;
  quote_description?: string | null;
  scheduled_for?: string | null;
  wait_for_notice?: boolean;
  total_usd: number;
  items_total: number;
  notes?: string;
  velitas?: boolean;
  receiver_name?: string | null;
  receiver_phone?: string | null;
  prepared?: boolean;
  prepared_at?: string | null;
  prepared_by_name?: string | null;
  created_by?: string;
  created_by_name?: string;
  paid_at?: string | null;
  delivered_at?: string | null;
  created_at: string;
  updated_at: string;
  route_polyline?: string | null;
  route_origin?: { lat: number; lng: number } | null;
}

export interface Notification {
  id: string;
  user_id: string;
  type: string;
  order_id?: string;
  message: string;
  read: boolean;
  created_at: string;
}

export interface DeliveryZone {
  id: string;
  name: string;
  polygon: number[][];
  delivery_cost_usd: number;
  color: string;
  created_at: string;
}

export interface Settings {
  key: string;
  exchange_rate_ves?: number;
  central_point_url?: string | null;
  central_point_lat?: number | null;
  central_point_lng?: number | null;
  updated_at?: string;
  [key: string]: any;
}

// Helpers to format Prisma objects to frontend expectations
export function formatUser(u: any): User {
  if (!u) return u;
  return {
    id: u.id,
    username: u.username,
    password_hash: u.password_hash,
    name: u.name,
    role: u.role,
    photo_data_url: u.photo_data_url,
    location: u.location_lat != null && u.location_lng != null
      ? {
          lat: u.location_lat,
          lng: u.location_lng,
          updated_at: u.location_updated_at ? new Date(u.location_updated_at).toISOString() : new Date().toISOString(),
        }
      : undefined,
    created_at: u.created_at ? new Date(u.created_at).toISOString() : new Date().toISOString(),
  };
}

export function formatCustomer(c: any): Customer {
  if (!c) return c;
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    gender: c.gender,
    order_count: c.order_count || 0,
    created_at: c.created_at ? new Date(c.created_at).toISOString() : new Date().toISOString(),
  };
}

export function formatFlavor(f: any): Flavor {
  if (!f) return f;
  return {
    id: f.id,
    name: f.name,
    price_usd: f.price_usd,
    available: f.available,
    stock: f.stock,
    stock_unlimited: f.stock_unlimited,
    image: f.image,
    sort_order: f.sort_order ?? 0,
    created_at: f.created_at ? new Date(f.created_at).toISOString() : new Date().toISOString(),
  };
}

export function formatOrder(o: any): Order {
  if (!o) return o;
  return {
    id: o.id,
    order_number: o.order_number,
    customer_id: o.customer_id,
    customer_name: o.customer_name,
    customer_phone: o.customer_phone || '',
    customer_gender: o.customer_gender,
    items: (o.items || []).map((it: any) => ({
      id: it.id,
      flavor_id: it.flavor_id,
      flavor_name: it.flavor_name,
      quantity: it.quantity,
      price_usd: it.price_usd,
    })),
    order_type: o.order_type,
    delivery_address: o.delivery_address,
    lat: o.lat,
    lng: o.lng,
    delivery_id: o.delivery_id,
    delivery_name: o.delivery_name,
    delivery_fee: o.delivery_fee,
    status: o.status,
    is_quote: o.is_quote,
    quote_description: o.quote_description,
    scheduled_for: o.scheduled_for,
    wait_for_notice: !!o.wait_for_notice,
    total_usd: o.total_usd,
    items_total: o.items_total,
    notes: o.notes || '',
    velitas: o.velitas,
    receiver_name: o.receiver_name,
    receiver_phone: o.receiver_phone,
    prepared: o.prepared,
    prepared_at: o.prepared_at ? new Date(o.prepared_at).toISOString() : null,
    prepared_by_name: o.prepared_by_name,
    created_by: o.created_by,
    created_by_name: o.created_by_name,
    paid_at: o.paid_at ? new Date(o.paid_at).toISOString() : null,
    delivered_at: o.delivered_at ? new Date(o.delivered_at).toISOString() : null,
    created_at: o.created_at ? new Date(o.created_at).toISOString() : new Date().toISOString(),
    updated_at: o.updated_at ? new Date(o.updated_at).toISOString() : new Date().toISOString(),
    route_polyline: o.route_polyline,
    route_origin: o.route_origin_lat != null && o.route_origin_lng != null
      ? { lat: o.route_origin_lat, lng: o.route_origin_lng }
      : null,
  };
}

export function formatNotification(n: any): Notification {
  if (!n) return n;
  return {
    id: n.id,
    user_id: n.user_id,
    type: n.type,
    order_id: n.order_id || undefined,
    message: n.message,
    read: n.read,
    created_at: n.created_at ? new Date(n.created_at).toISOString() : new Date().toISOString(),
  };
}

export function formatDeliveryZone(z: any): DeliveryZone {
  if (!z) return z;
  return {
    id: z.id,
    name: z.name,
    polygon: typeof z.polygon === 'string' ? JSON.parse(z.polygon) : (z.polygon || []),
    delivery_cost_usd: z.delivery_cost_usd,
    color: z.color,
    created_at: z.created_at ? new Date(z.created_at).toISOString() : new Date().toISOString(),
  };
}
