import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

const csvData = `Numero,Fecha,Hora,Cliente,Telefono,Sabores,Repartidor,Estado,Total USD,Total VES,Delivery USD,Notas
PED-E12B9684,2026-08-11,17:11,María ,+584243669796,Cacao denso MED x1,Oscar,en_camino,13.5,10276.43,1.5,
PED-7C89CA66,2026-08-11,17:10,Yuriexy Guevara,+584243348194,Cacao denso MED x1,Jose Angel,entregado,12.7,9667.45,0.7,
PED-4D9F7B93,2026-08-11,16:58,Frank,+14243225253,Clásico MED x1,Victor,entregado,13.5,10276.43,1.5,
PED-A102EE26,2026-08-11,16:40,Nani ,+584144919361,Clásico MED x1,Oscar,entregado,13.92,10596.14,1.92,
PED-DE791936,2026-08-11,16:34,Indira,+584125570735,Clásico MED x1,Jose Angel,entregado,13.5,10276.43,1.5,
PED-D26266CC,2026-08-11,16:18,Anthony Sandoval,+12398392724,"Clásico IND x1, Clásico MED x1",Victor,entregado,21.77,16571.69,3.77,
PED-9216488E,2026-08-11,16:16,Kelwin Aguilar ,+584243419250,"Clásico MED x1, Cacao denso IND x1",Jose Angel,entregado,19.5,14843.73,1.5,
PED-FD93C45D,2026-08-11,16:11,Carlos Serantes,+584143446051,Clásico MED x1,Jose Angel,entregado,13.0,9895.82,1.0,
PED-AAB9D0EB,2026-08-11,15:58,Pablo Andres Solorzano,+58444444,Clásico MED x1,Oscar,entregado,16.72,12727.54,4.72,
PED-BCF433A5,2026-08-11,15:50,Bisnelia,+584144439086,Clásico MED x1,Victor,entregado,15.4,11722.74,3.4,
PED-E192AE84,2026-08-11,15:47,Marianella,+584246023350,Cacao denso IND x1,Jose Angel,entregado,8.9,6774.83,2.9,
PED-88BC3B5F,2026-08-11,15:46,Sinay Peña,+584243292273,Cacao denso IND x1,Victor,entregado,8.46,6439.89,2.46,
PED-DCE339AF,2026-08-11,15:41,Julio,+584149453091,Clásico MED x2,Oscar,entregado,25.99,19784.02,1.99,
PED-EA425CFB,2026-08-11,15:31,Cynthya,+584121308620,"Cacao denso MED x1, Clásico IND x1",Jose Angel,entregado,19.5,14843.73,1.5,
PED-5E1C4495,2026-08-11,14:58,Andrea,+584243483571,Cacao denso MED x1,Pickup en tienda,entregado,12.0,9134.6,0,
PED-85992243,2026-08-11,14:42,Erika,+584124000644,Clásico IND x1,Victor,entregado,9.13,6949.91,3.13,
PED-CB48BD33,2026-08-11,14:33,Ydomar,+584242059486,Clásico IND x1,Jose Angel,entregado,7.5,5709.13,1.5,
PED-45F870FC,2026-08-11,14:20,Mila,+584140495119,Clásico MED x1,Pickup en tienda,entregado,12.0,9134.6,0,
PED-4EC93A66,2026-08-11,14:03,Bárbara Fuentes,+584144785343,Clásico MED x1,,pendiente,13.91,10588.52,1.91,7:30 DE LA NOCHE MARDITOS TODOS.
PED-862E3174,2026-08-11,14:00,Mariangel Simpatica,+584243005460,Cacao denso MED x2,Jose Angel,entregado,24.0,18269.2,0.0,
PED-5CEA371B,2026-08-11,13:45,Adriana,+584243791951,Cacao denso GRN x1,,pendiente,25.93,19738.35,1.93,"MIERCOLES 12, A LAS 11AM"
PED-B9F72338,2026-08-11,13:32,Mirtha Luna,+584144902308,Cacao denso MED x1,Oscar,entregado,13.5,10276.43,1.5,Espero por la av.bolivar
PED-50CB0DB6,2026-08-11,13:28,Andrea,+584128604175,Cacao denso MED x1,Oscar,entregado,13.5,10276.43,1.5,
PED-F8887C1F,2026-08-11,13:18,Lisbeth,+584126723741,Clásico MED x1,Victor,entregado,15.93,12126.18,3.93,
PED-D44B0B7A,2026-08-11,13:12,Nelson Caraballo,+584144630149,"Clásico IND x1, Cacao denso IND x1",Oscar,entregado,13.5,10276.43,1.5,
PED-9B2E8FBF,2026-08-11,13:07,Alexander,+584141497316,Clásico MED x1,Victor,entregado,16.0,12179.47,4.0,
PED-F92422E8,2026-08-11,12:57,Vecinos,+584120000000,Clásico MED x1,Pickup en tienda,entregado,12.0,9134.6,0,`;

function parseCSVLine(line: string) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
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

async function importOrders() {
  const lines = csvData.trim().split('\n').slice(1);
  const dbFlavors = await prisma.flavor.findMany();
  let createdOrders = 0;

  for (const line of lines) {
    if (!line.trim() || line.startsWith('RESUMEN') || line.startsWith('Total pedidos') || line.startsWith('Entregados') || line.startsWith('Cancelados') || line.startsWith('Ingresos') || line.startsWith('Ticket')) continue;
    
    const parts = parseCSVLine(line);
    if (parts.length < 11) continue;

    const [order_number, fecha, hora, rawCliente, rawPhone, rawSabores, repartidor, estado, totalUsd, totalVes, deliveryUsd, notas] = parts;

    // find order
    const existing = await prisma.order.findFirst({ where: { order_number } });
    if (existing) {
      console.log(`Order ${order_number} already exists, skipping.`);
      continue;
    }

    const clienteName = rawCliente.trim();
    const phone = rawPhone.trim();

    // ensure customer
    let customer = await prisma.customer.findFirst({ where: { phone } });
    if (!customer && phone && clienteName) {
      customer = await prisma.customer.create({
        data: { name: clienteName, phone, order_count: 1 }
      });
    } else if (customer) {
      await prisma.customer.update({
        where: { id: customer.id },
        data: { order_count: { increment: 1 } }
      });
    }

    // parse items
    const flavorStrings = rawSabores.split(',').map(s => s.trim());
    const itemsData = [];
    for (const fs of flavorStrings) {
      const match = fs.match(/(.+) x(\d+)/);
      if (match) {
        const fname = match[1].trim();
        const qty = parseInt(match[2]);
        const f = dbFlavors.find(fl => fl.name.toLowerCase() === fname.toLowerCase());
        if (f) {
          itemsData.push({
            flavor_id: f.id,
            flavor_name: f.name,
            quantity: qty,
            price_usd: f.price_usd
          });
        }
      }
    }

    const oDate = new Date(`${fecha}T${hora}:00-04:00`); // assuming Venezuela time
    const parsedTotalUsd = parseFloat(totalUsd);
    const parsedDeliveryUsd = parseFloat(deliveryUsd) || 0;
    
    let isPickup = repartidor === 'Pickup en tienda';
    
    await prisma.order.create({
      data: {
        order_number,
        customer_id: customer?.id || null,
        customer_name: clienteName,
        customer_phone: phone,
        order_type: isPickup ? 'pickup' : 'delivery',
        delivery_address: '', // empty from csv
        delivery_name: isPickup ? null : (repartidor || null),
        delivery_fee: parsedDeliveryUsd,
        status: estado === 'en_camino' ? 'en_camino' : (estado === 'entregado' ? 'entregado' : 'pendiente'),
        total_usd: parsedTotalUsd,
        items_total: parsedTotalUsd - parsedDeliveryUsd,
        notes: notas || null,
        created_at: oDate,
        items: {
          create: itemsData
        }
      }
    });
    createdOrders++;
  }
  console.log(`Imported ${createdOrders} missing orders.`);
}

importOrders().catch(console.error).finally(() => prisma.$disconnect());
