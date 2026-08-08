import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

const FEMALE_NAMES = new Set([
  'genesis', 'génesis', 'maryam', 'amalia', 'steff', 'aída', 'aida', 'norexys', 'daniela',
  'virgy', 'ana', 'flor', 'yolanda', 'endrina', 'eli', 'michiko', 'alexandra',
  'krelina', 'andrea', 'sailin', 'antonella', 'claudia', 'grecia', 'miranda',
  'stephanie', 'marietta', 'merlyn', 'carliz', 'leonor', 'isabel', 'maría', 'maria',
  'ysa', 'ydanys', 'sofia', 'sofía', 'yorgelis', 'lilianggye', 'nakari', 'loreana', 'nikki',
  'victoria', 'ivana', 'nesmar', 'joibimar', 'mary', 'vanessa', 'yormary', 'mila',
  'gloria', 'jennifer', 'reina', 'yastnel', 'anyumar', 'coromoto', 'angelica', 'angélica',
  'teresa', 'ambar', 'ámbar', 'angie', 'jhonexsy', 'lyly', 'carolina', 'indira',
  'yessenia', 'giovanna', 'analicia', 'aldimar', 'patricia', 'rosell', 'igle',
  'nila', 'kirsten', 'diana', 'fernanda', 'paola', 'anaholy', 'norka',
  'veronica', 'verónica', 'laury', 'melany', 'yessika', 'daniella', 'oriana',
  'orianna', 'virginia', 'iliana', 'astrid', 'yolianny', 'maru', 'valentina',
  'camila', 'alejandra', 'dayana', 'michel', 'michelle', 'alanis', 'geormary',
  'carolina', 'francis', 'veruschka', 'yorlly', 'jhosse', 'vicky', 'aleja',
  'aleida', 'mayra', 'nicole', 'norys', 'etdriana', 'yopzany', 'valeria',
  'nathaly', 'vivi', 'maggie', 'josvic', 'maryangel', 'belkys', 'rusideth',
  'gabriela', 'laura', 'dakari', 'marina', 'deysi', 'caro', 'lisbeidy',
  'yurisma', 'yulbir', 'alalí', 'alali', 'ysve', 'rosa', 'ani', 'sophie',
  'kashlee', 'katherin', 'alondra', 'melanie', 'jorgelina', 'ederli', 'elisa',
  'milehidy', 'deyanira', 'angela', 'ángela', 'saray', 'elia', 'yusbeli',
  'solangel', 'jessica', 'dania', 'zena', 'marly', 'josyeliz', 'aracelis',
  'ludy', 'yennifer', 'gladys', 'shasira', 'dulce', 'eglis', 'emilis', 'alicia',
  'mariangel', 'eaglis', 'dianita', 'madeley', 'rosi', 'ross', 'edelyn',
  'roxabell', 'lismar', 'domenica', 'kory', 'luisa', 'kate', 'lendimar',
  'rossana', 'wendy', 'patrizia', 'sasha', 'zunny', 'stefany', 'yelitza',
  'mavi', 'rosmary', 'norvi', 'margarita', 'rosana', 'omaira', 'clarelys',
  'stella', 'flavia', 'candy', 'mariana', 'ori', 'anisa', 'mariam', 'sosire',
  'candida', 'cándida', 'solibeth', 'georgina', 'caroli', 'maybeth', 'mari',
  'gaby', 'liri', 'josi', 'jacqueline', 'elsy', 'sarah', 'nella', 'carilyn',
  'sol', 'lorenzo', 'alecia', 'jalma', 'nelemar', 'liudmila', 'rossanna',
  'damaris', 'getzi', 'adrielys', 'angeles', 'ángeles', 'charles', 'anaida',
  'brenda', 'greta', 'julieta', 'pao', 'julieta', 'bárbara', 'barbara',
  'priscila', 'yaliska', 'gigliola', 'vero', 'iselen', 'nury', 'ligia', 'karen',
  'ivette', 'kimberlyng', 'sthephany', 'andreína', 'andreina', 'oscary',
  'graciela', 'evelyn', 'marisol', 'cindy', 'albany', 'aneliza', 'ginette',
  'jhona', 'sayi', 'edith', 'davianna', 'yandhira', 'isveliss', 'crisalida',
  'eliangel', 'ruth', 'elizabeth', 'silvia', 'liliana', 'yulimar', 'elba',
  'carla', 'louisse', 'mairyn', 'erika', 'hellen', 'ygma', 'yuli', 'yani',
  'yuribeth', 'viviana', 'cathryn', 'glenda', 'scarleth', 'lindsy', 'bianca',
  'enmanuel', 'yacenia', 'jhusgrey', 'leonela', 'alice', 'yomaira', 'ane',
  'jocarli', 'romi', 'yessi', 'kelly', 'kat', 'solecito', 'luci', 'anick',
  'albani', 'karly', 'yhonni', 'mercedes', 'ginella', 'zoi', 'yelitza',
  'ericson', 'rebeca', 'fiorella', 'astrid', 'jeisy', 'carmen', 'dianita',
  'sophia', 'josiany', 'yenni', 'eiry', 'coromoto', 'bethania', 'dayani',
  'anneliz', 'nathalie', 'janeth', 'marivic', 'danny', 'hoglys', 'lucy',
  'franyelis', 'nilda', 'yancy', 'isy', 'nina', 'nayaly', 'alfonsina', 'od',
  'yesenia', 'tania', 'yolimar', 'isabel', 'dleiderman', 'conceta', 'erianny',
  'kary', 'margareth', 'luisianys', 'narli', 'áfrica', 'africa', 'francys',
  'normalia', 'sosire', 'karla', 'salomé', 'salome', 'nailit', 'soraima',
  'joriannis', 'lisbeth', 'euny', 'enyeli', 'costanza', 'zol', 'dali',
  'scarlet', 'valeria', 'katy', 'andor', 'rita', 'yrailyn', 'rocío', 'rocio',
  'mineli', 'sam', 'mayorxy', 'niza', 'juliany', 'yeli', 'mirian', 'amozandra',
  'delianis', 'graemi', 'norelis', 'leudys', 'floriana', 'angelba', 'karla',
  'yineth', 'frebellys', 'majo', 'alvimar', 'kyrenia', 'yosemyn', 'vivi',
  'lily', 'morella', 'marialejandra', 'ceci', 'rosalejandra', 'yrene',
  'aslyn', 'melissa', 'gleiccy', 'mariu', 'eliana', 'kreiza', 'raisa', 'yexiger',
  'anita', 'dixon', 'Igle', 'yuriher', 'aaron', 'josselin', 'verónica',
  'doly', 'ale', 'desiree', 'willianys', 'jeremy', 'franye', 'stefani',
  'kenneth', 'silvana', 'sthefania', 'wilman', 'dilbanis', 'angely', 'alicia',
  'ivanella', 'ucrania', 'migreilys', 'oswaldo', 'ysaunil', 'normarys',
  'clorimar', 'katherine', 'arelys', 'virginia', 'elisy', 'elsy', 'sabrina',
  'miriam', 'aliferceci', 'karlex', 'crismel', 'luz', 'alimar', 'deivis',
  'arnalibeth', 'ybol', 'chicha', 'mario', 'janes', 'gigi', 'tomas', 'tomás',
  'rose', 'nathali', 'neyba', 'lis', 'emilis', 'yingris', 'sandra', 'marieth',
  'dorus', 'beatriz', 'cucho', 'ray', 'gustavo', 'fabiola', 'kisie',
  'johansson', 'marian', 'yessika', 'diego', 'wilermys', 'axel', 'gregorio',
  'zena', 'césar', 'cesar', 'moises', 'moisés', 'alexis', 'theisy', 'lyly',
  'angela', 'marcos', 'marysol', 'conrado', 'jeisy', 'leandro', 'henry',
  'nathalie', 'claudio', 'pastor', 'fran', 'angie', 'stela', 'marcos', 'gregorio',
  'chicha', 'neni', 'jas', 'tino'
]);

function isFemaleName(name: string): boolean {
  if (!name) return false;
  const clean = name.trim().toLowerCase();

  if (clean.includes('sra') || clean.includes('sra.') || clean.includes('señora') || clean.includes('senora') || clean.includes('chica') || clean.includes('chicas')) {
    return true;
  }
  if (clean.includes('(cotizacion') || clean.includes('cotización') || clean.includes('vecinos')) {
    return false;
  }

  const tokens = clean.split(/\s+/);
  const firstToken = tokens[0].replace(/[^a-záéíóúñ]/gi, '');
  if (FEMALE_NAMES.has(firstToken)) return true;

  if (tokens.length > 1) {
    const secondToken = tokens[1].replace(/[^a-záéíóúñ]/gi, '');
    if (FEMALE_NAMES.has(secondToken)) return true;
  }

  return false;
}

async function main() {
  console.log('🧹 Limpiando base de datos...');

  await prisma.orderItem.deleteMany({});
  await prisma.order.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.stockMovement.deleteMany({});
  await prisma.user.deleteMany({});

  console.log('👤 Creando usuarios administradores y repartidores...');

  await prisma.user.create({
    data: {
      id: 'u-jhonnylubo-admin',
      username: 'jhonnylubo',
      password_hash: hashPassword('241198'),
      name: 'Jhonny lubo',
      role: 'admin',
    },
  });

  await prisma.user.create({
    data: {
      id: 'u-ivan-admin',
      username: 'ivan',
      password_hash: hashPassword('1234'),
      name: 'Ivan',
      role: 'admin',
    },
  });

  const driversToEnsure = [
    { username: 'joseangel', name: 'Jose Angel', role: 'repartidor' },
    { username: 'victor', name: 'Victor', role: 'repartidor' },
    { username: 'oscar', name: 'Oscar', role: 'repartidor' },
    { username: 'ezequiel', name: 'Ezequiel', role: 'repartidor' },
    { username: 'axel', name: 'Axel', role: 'repartidor' },
  ];

  const driverUserMap = new Map<string, string>();
  for (const d of driversToEnsure) {
    const u = await prisma.user.create({
      data: {
        username: d.username,
        password_hash: hashPassword('1234'),
        name: d.name,
        role: d.role,
      },
    });
    driverUserMap.set(d.username, u.id);
  }

  const flavorsData = [
    { id: 'f-clasico-01', name: 'Clásico', price_usd: 10.0, available: true, stock: 0, stock_unlimited: true, sort_order: 0 },
    { id: 'f-cacao-02', name: 'Cacao Denso', price_usd: 10.0, available: true, stock: 0, stock_unlimited: true, sort_order: 1 },
    { id: 'f-pistacho-03', name: 'Pistacho Cream', price_usd: 12.0, available: true, stock: 0, stock_unlimited: true, sort_order: 2 },
    { id: 'f-nutella-04', name: 'Nutella Crunch', price_usd: 12.0, available: true, stock: 0, stock_unlimited: true, sort_order: 3 },
    { id: 'f-frutos-05', name: 'Frutos Rojos', price_usd: 11.0, available: true, stock: 0, stock_unlimited: true, sort_order: 4 },
  ];

  for (const f of flavorsData) {
    await prisma.flavor.upsert({
      where: { id: f.id },
      update: { price_usd: f.price_usd, available: f.available },
      create: f,
    });
  }

  await prisma.appSettings.upsert({
    where: { key: 'app_settings' },
    update: { exchange_rate_ves: 756.7083 },
    create: {
      key: 'app_settings',
      exchange_rate_ves: 756.7083,
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

  console.log('📦 Importando datos reales del CSV...');
  
  // Import CSV data logic
  const { seedCSVData } = await import('./seed_orders');
  await seedCSVData();

  console.log('✅ Base de datos poblada exitosamente con clientes, géneros y pedidos reales!');
}

main()
  .catch((e) => {
    console.error('Error al poblar base de datos:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
