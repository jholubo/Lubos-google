import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

function subDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

async function main() {
  console.log('🌱 Seeding initial and sample data...');

  // 1. Users
  await prisma.user.upsert({
    where: { username: 'jhonny' },
    update: { password_hash: hashPassword('1234') },
    create: {
      id: 'u-jhonny-001',
      username: 'jhonny',
      password_hash: hashPassword('1234'),
      name: 'Jhonny',
      role: 'admin',
    },
  });

  await prisma.user.upsert({
    where: { username: 'ivan' },
    update: { password_hash: hashPassword('1234') },
    create: {
      id: 'u-ivan-002',
      username: 'ivan',
      password_hash: hashPassword('1234'),
      name: 'Ivan',
      role: 'vendedor',
    },
  });

  await prisma.user.upsert({
    where: { username: 'oscar' },
    update: { password_hash: hashPassword('1234') },
    create: {
      id: 'u-oscar-003',
      username: 'oscar',
      password_hash: hashPassword('1234'),
      name: 'Oscar',
      role: 'delivery',
    },
  });

  await prisma.user.upsert({
    where: { username: 'carlos' },
    update: { password_hash: hashPassword('1234') },
    create: {
      id: 'u-carlos-004',
      username: 'carlos',
      password_hash: hashPassword('1234'),
      name: 'Carlos Delivery',
      role: 'delivery',
    },
  });

  // 2. Flavors
  const flavorsData = [
    {
      id: 'f-clasico-01',
      name: 'Clásico',
      price_usd: 10.0,
      available: true,
      stock: 25,
      stock_unlimited: false,
      sort_order: 0,
    },
    {
      id: 'f-cacao-02',
      name: 'Cacao Denso',
      price_usd: 10.0,
      available: true,
      stock: 18,
      stock_unlimited: false,
      sort_order: 1,
    },
    {
      id: 'f-pistacho-03',
      name: 'Pistacho Cream',
      price_usd: 12.0,
      available: true,
      stock: 12,
      stock_unlimited: false,
      sort_order: 2,
    },
    {
      id: 'f-nutella-04',
      name: 'Nutella Crunch',
      price_usd: 12.0,
      available: true,
      stock: 15,
      stock_unlimited: false,
      sort_order: 3,
    },
    {
      id: 'f-frutos-05',
      name: 'Frutos Rojos',
      price_usd: 11.0,
      available: true,
      stock: 10,
      stock_unlimited: false,
      sort_order: 4,
    },
  ];

  for (const f of flavorsData) {
    await prisma.flavor.upsert({
      where: { id: f.id },
      update: { price_usd: f.price_usd, stock: f.stock, available: f.available },
      create: f,
    });
  }

  // 3. Customers
  const customersData = [
    { id: 'c-maria-01', name: 'María Rodríguez', phone: '+584121112233', gender: 'femenino', order_count: 5 },
    { id: 'c-carlos-02', name: 'Carlos Pérez', phone: '+584149998877', gender: 'masculino', order_count: 3 },
    { id: 'c-ana-03', name: 'Ana Gómez', phone: '+584245554433', gender: 'femenino', order_count: 8 },
    { id: 'c-luis-04', name: 'Luis Fernández', phone: '+584127776655', gender: 'masculino', order_count: 2 },
    { id: 'c-sofia-05', name: 'Sofía Martínez', phone: '+584163332211', gender: 'femenino', order_count: 4 },
  ];

  for (const c of customersData) {
    await prisma.customer.upsert({
      where: { id: c.id },
      update: c,
      create: c,
    });
  }

  // 4. App & Widget Settings
  await prisma.appSettings.upsert({
    where: { key: 'app_settings' },
    update: { exchange_rate_ves: 36.5 },
    create: {
      key: 'app_settings',
      exchange_rate_ves: 36.5,
      central_point_lat: 10.2469,
      central_point_lng: -67.5958,
    },
  });

  await prisma.widgetSettings.upsert({
    where: { key: 'widget_settings' },
    update: {},
    create: {
      key: 'widget_settings',
      msg_stock_1: 'Quedan 1',
      msg_stock_2: 'Quedan 2',
      msg_stock_3: 'Quedan 3',
      msg_stock_4: 'Quedan 4',
      msg_stock_5: 'Quedan 5',
      msg_out: 'Agotados',
    },
  });

  // 5. Delivery Zones
  const zonesData = [
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
    },
  ];

  for (const z of zonesData) {
    await prisma.deliveryZone.upsert({
      where: { id: z.id },
      update: z,
      create: z,
    });
  }

  // 6. Orders across multiple days
  const now = new Date();

  const ordersSeed = [
    // Today - Pendiente delivery
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
      prepared_at: now,
      prepared_by_name: 'Ivan',
      created_by: 'u-ivan-002',
      created_by_name: 'Ivan',
      total_usd: 22.5,
      items_total: 20.0,
      created_at: now,
      updated_at: now,
      items: [
        { flavor_id: 'f-clasico-01', flavor_name: 'Clásico', quantity: 1, price_usd: 10.0 },
        { flavor_id: 'f-pistacho-03', flavor_name: 'Pistacho Cream', quantity: 1, price_usd: 12.0 },
      ],
    },

    // Today - En camino delivery
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
      prepared_at: now,
      prepared_by_name: 'Ivan',
      created_by: 'u-jhonny-001',
      created_by_name: 'Jhonny',
      total_usd: 15.0,
      items_total: 12.0,
      created_at: now,
      updated_at: now,
      items: [
        { flavor_id: 'f-nutella-04', flavor_name: 'Nutella Crunch', quantity: 1, price_usd: 12.0 },
      ],
    },

    // Today - Entregado hoy
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
      paid_at: now,
      delivered_at: now,
      prepared: true,
      prepared_at: now,
      prepared_by_name: 'Ivan',
      created_by: 'u-ivan-002',
      created_by_name: 'Ivan',
      total_usd: 24.5,
      items_total: 22.0,
      created_at: now,
      updated_at: now,
      items: [
        { flavor_id: 'f-clasico-01', flavor_name: 'Clásico', quantity: 1, price_usd: 10.0 },
        { flavor_id: 'f-frutos-05', flavor_name: 'Frutos Rojos', quantity: 1, price_usd: 11.0 },
      ],
    },

    // Today - Pickup pendiente
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
      created_at: now,
      updated_at: now,
      items: [
        { flavor_id: 'f-cacao-02', flavor_name: 'Cacao Denso', quantity: 2, price_usd: 10.0 },
      ],
    },

    // Yesterday - Entregado
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
      paid_at: subDays(now, 1),
      delivered_at: subDays(now, 1),
      prepared: true,
      created_by: 'u-jhonny-001',
      created_by_name: 'Jhonny',
      total_usd: 36.5,
      items_total: 34.0,
      created_at: subDays(now, 1),
      updated_at: subDays(now, 1),
      items: [
        { flavor_id: 'f-clasico-01', flavor_name: 'Clásico', quantity: 1, price_usd: 10.0 },
        { flavor_id: 'f-pistacho-03', flavor_name: 'Pistacho Cream', quantity: 2, price_usd: 12.0 },
      ],
    },

    // 2 Days ago - Entregado
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
      paid_at: subDays(now, 2),
      delivered_at: subDays(now, 2),
      prepared: true,
      created_by: 'u-ivan-002',
      created_by_name: 'Ivan',
      total_usd: 22.5,
      items_total: 20.0,
      created_at: subDays(now, 2),
      updated_at: subDays(now, 2),
      items: [
        { flavor_id: 'f-cacao-02', flavor_name: 'Cacao Denso', quantity: 2, price_usd: 10.0 },
      ],
    },

    // 3 Days ago - Entregado
    {
      id: 'ord-prev-02',
      order_number: 'PED-0972',
      customer_id: 'c-ana-03',
      customer_name: 'Ana Gómez',
      customer_phone: '+584245554433',
      customer_gender: 'femenino',
      order_type: 'delivery',
      delivery_address: 'Las Mercedes Calle Paris',
      lat: 10.485,
      lng: -66.863,
      delivery_id: 'u-oscar-003',
      delivery_name: 'Oscar',
      delivery_fee: 3.0,
      status: 'entregado',
      paid_at: subDays(now, 3),
      delivered_at: subDays(now, 3),
      prepared: true,
      created_by: 'u-jhonny-001',
      created_by_name: 'Jhonny',
      total_usd: 27.0,
      items_total: 24.0,
      created_at: subDays(now, 3),
      updated_at: subDays(now, 3),
      items: [
        { flavor_id: 'f-nutella-04', flavor_name: 'Nutella Crunch', quantity: 2, price_usd: 12.0 },
      ],
    },

    // 5 Days ago - Entregado
    {
      id: 'ord-prev-03',
      order_number: 'PED-0950',
      customer_id: 'c-carlos-02',
      customer_name: 'Carlos Pérez',
      customer_phone: '+584149998877',
      customer_gender: 'masculino',
      order_type: 'pickup',
      delivery_address: 'Retiro en Tienda',
      delivery_fee: 0,
      status: 'entregado',
      paid_at: subDays(now, 5),
      delivered_at: subDays(now, 5),
      prepared: true,
      created_by: 'u-ivan-002',
      created_by_name: 'Ivan',
      total_usd: 30.0,
      items_total: 30.0,
      created_at: subDays(now, 5),
      updated_at: subDays(now, 5),
      items: [
        { flavor_id: 'f-clasico-01', flavor_name: 'Clásico', quantity: 3, price_usd: 10.0 },
      ],
    },
  ];

  for (const o of ordersSeed) {
    const { items, ...orderData } = o;

    const existingOrder = await prisma.order.findUnique({ where: { id: o.id } });
    if (existingOrder) {
      await prisma.orderItem.deleteMany({ where: { order_id: o.id } });
      await prisma.order.delete({ where: { id: o.id } });
    }

    await prisma.order.create({
      data: {
        ...orderData,
        items: {
          create: items,
        },
      },
    });
  }

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

