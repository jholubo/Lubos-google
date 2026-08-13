import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteToday() {
  const startOfDay = new Date('2026-08-11T00:00:00.000Z');
  const endOfDay = new Date('2026-08-11T23:59:59.999Z');

  // Also include scheduled_for ? "today" could mean scheduled_for OR created_at. Let's just do created_at and scheduled_for matching 2026-08-11.
  
  const todayOrders = await prisma.order.findMany({
    where: {
      OR: [
        {
          created_at: {
            gte: startOfDay,
            lte: endOfDay
          }
        },
        {
          scheduled_for: {
            startsWith: '2026-08-11'
          }
        }
      ]
    }
  });

  console.log(`Found ${todayOrders.length} orders from today.`);

  const customerIds = todayOrders.map(o => o.customer_id).filter(Boolean);
  const uniqueCustomerIds = [...new Set(customerIds)];

  console.log(`Found ${uniqueCustomerIds.length} unique customers attached to these orders.`);

  if (todayOrders.length > 0) {
    const deletedOrders = await prisma.order.deleteMany({
      where: {
        id: { in: todayOrders.map(o => o.id) }
      }
    });
    console.log(`Deleted ${deletedOrders.count} orders.`);
  }

  if (uniqueCustomerIds.length > 0) {
    const deletedCustomers = await prisma.customer.deleteMany({
      where: {
        id: { in: uniqueCustomerIds as string[] }
      }
    });
    console.log(`Deleted ${deletedCustomers.count} customers.`);
  }
}

deleteToday().catch(console.error).finally(() => prisma.$disconnect());
