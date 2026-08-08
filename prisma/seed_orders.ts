import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

// Spanish female first names / common indicators
const FEMALE_NAMES = new Set([
  'genesis', 'maryam', 'amalia', 'steff', 'aída', 'aida', 'norexys', 'daniela',
  'virgy', 'ana', 'flor', 'yolanda', 'endrina', 'eli', 'michiko', 'alexandra',
  'krelina', 'andrea', 'sailin', 'antonella', 'claudia', 'grecia', 'miranda',
  'stephanie', 'marietta', 'merlyn', 'carliz', 'leonor', 'isabel', 'maría', 'maria',
  'ysa', 'ydanys', 'sofia', 'yorgelis', 'lilianggye', 'nakari', 'loreana', 'nikki',
  'victoria', 'ivana', 'nesmar', 'joibimar', 'mary', 'vanessa', 'yormary', 'mila',
  'gloria', 'jennifer', 'reina', 'yastnel', 'anyumar', 'coromoto', 'angelica',
  'claudia', 'teresa', 'ambar', 'angie', 'jhonexsy', 'lyly', 'carolina', 'indira',
  'yessenia', 'giovanna', 'analicia', 'aldimar', 'patricia', 'rosell', 'igle',
  'nila', 'kirsten', 'diana', 'maría', 'fernanda', 'paola', 'anaholy', 'norka',
  'veronica', 'verónica', 'laury', 'melany', 'yessika', 'daniella', 'oriana',
  'orianna', 'virginia', 'iliana', 'astrid', 'yolianny', 'maru', 'valentina',
  'paola', 'camila', 'alejandra', 'dayana', 'michel', 'michelle', 'alanis',
  'geormary', 'andrea', 'rosales', 'carolina', 'francis', 'veruschka', 'yorlly',
  'vanessa', 'jhosse', 'camila', 'vicky', 'ana', 'aleja', 'aleida', 'mayra',
  'nicole', 'norys', 'etdriana', 'iliana', 'yopzany', 'valeria', 'nathaly',
  'vivi', 'maggie', 'josvic', 'maryangel', 'belkys', 'rusideth', 'gabriela',
  'laura', 'genesis', 'dakari', 'marina', 'deysi', 'julio', 'caro', 'lisbeidy',
  'maria', 'yurisma', 'yulbir', 'sofia', 'alalí', 'ysve', 'rosa', 'yessika',
  'ani', 'genesis', 'maria', 'sophie', 'antonella', 'kashlee', 'giovanna',
  'katherin', 'victoria', 'alondra', 'daniela', 'melanie', 'jorgelina', 'nakari',
  'ederli', 'elisa', 'ana', 'oriana', 'milehidy', 'deyanira', 'michelle', 'angela',
  'saray', 'elia', 'yusbeli', 'solangel', 'jessica', 'dania', 'zena', 'maria',
  'marly', 'paola', 'josyeliz', 'aracelis', 'valentina', 'ludy', 'yennifer',
  'gladys', 'shasira', 'dulce', 'andrea', 'shasira', 'andrea', 'maryangel',
  'michelle', 'gabriela', 'eglis', 'emilis', 'alicia', 'mariangel', 'vicky',
  'eaglis', 'emilis', 'dianita', 'ana', 'madeley', 'melanie', 'rosi', 'ross',
  'edelyn', 'dayana', 'laury', 'melany', 'roxabell', 'lismar', 'domenica',
  'nicole', 'kory', 'luisa', 'kate', 'lendimar', 'angie', 'rossana', 'maría',
  'vicky', 'wendy', 'patrizia', 'sasha', 'zunny', 'stefany', 'génesis', 'yelitza',
  'andrea', 'carlos', 'mavi', 'rosmary', 'anick', 'yelitza', 'norvi', 'margarita',
  'victoria', 'rosana', 'omaira', 'virgy', 'clarelys', 'andrea', 'andrea',
  'stella', 'flavia', 'mila', 'génesis', 'mary', 'candy', 'mariana', 'ori',
  'anisa', 'mariam', 'sosire', 'yolanda', 'ivana', 'candida', 'solibeth',
  'georgina', 'caroli', 'maría', 'candy', 'petunia', 'maybeth', 'mari', 'gaby',
  'liri', 'josi', 'mariana', 'lendimar', 'jacqueline', 'patrizia', 'elsy',
  'vanessa', 'ana', 'maría', 'maria', 'mayerlin', 'sarah', 'yennifer', 'wilmary',
  'alali', 'carilyn', 'sol', 'anavis', 'nathy', 'andrea', 'maria', 'maría',
  'alecia', 'francys', 'rebe', 'jalma', 'nelemar', 'liudmila', 'rossanna',
  'damaris', 'solibeth', 'getzi', 'mila', 'yennifer', 'adrielys', 'angeles',
  'damelys', 'valentina', 'anaida', 'brenda', 'maría', 'greta', 'mayra', 'ana',
  'andrea', 'julieta', 'pao', 'bárbara', 'barbara', 'vanessa', 'virgy', 'francis',
  'priscila', 'yaliska', 'miranda', 'gigliola', 'vero', 'iselen', 'nury', 'ligia',
  'karen', 'ivette', 'kimberlyng', 'sthephany', 'andreína', 'andreina', 'oscary',
  'maria', 'maría', 'norelbis', 'graciela', 'evelyn', 'marisol', 'angelica',
  'cindy', 'albany', 'aneliza', 'krelina', 'ginette', 'barbara', 'davianna',
  'ana', 'yandhira', 'valentina', 'mariana', 'edgar', 'nai', 'isveliss',
  'crisalida', 'barbara', 'michelle', 'andreina', 'maria', 'maría', 'vanesa',
  'eliangel', 'ruth', 'elizabeth', 'nakari', 'francis', 'silvia', 'liliana',
  'yulimar', 'andrea', 'elba', 'carla', 'patricia', 'genesis', 'louisse',
  'gabriela', 'jennifer', 'mairyn', 'erika', 'hellen', 'ygma', 'yuli', 'barbara',
  'yani', 'yuribeth', 'viviana', 'teresa', 'shasira', 'cathryn', 'andreina',
  'glenda', 'mariangel', 'glenda', 'sol', 'scarleth', 'patricia', 'nicole',
  'carla', 'daniela', 'francis', 'lindsy', 'bianca', 'angeles', 'enmanuel',
  'yacenia', 'ana', 'maría', 'maria', 'jhusgrey', 'leonela', 'alice', 'yomaira',
  'ane', 'jocarli', 'romi', 'yessi', 'gabriela', 'francis', 'kelly', 'kat',
  'yennifer', 'jennifer', 'fran', 'solecito', 'carmen', 'luci', 'anick',
  'jessica', 'sol', 'lismar', 'mayerlin', 'albani', 'karly', 'andreina',
  'edwar', 'loreana', 'angeles', 'yhonni', 'mercedes', 'sofia', 'luisiana',
  'maria', 'maría', 'ginella', 'marisol', 'zoi', 'marisol', 'petunia', 'vanessa',
  'yelitza', 'paola', 'jhusgrey', 'belkys', 'rebeca', 'miranda', 'krelina',
  'fiorella', 'astrid', 'oriana', 'arianna', 'mela', 'nella', 'mayra', 'angelis',
  'anyismar', 'alithea', 'liliana', 'damelys', 'nilda', 'dana', 'fahiris',
  'mhaida', 'issajar', 'yadhira', 'fabiola', 'eva', 'andrea', 'caro', 'dleiderman',
  'catherine', 'fiorella', 'nakari', 'marivic', 'chiquinquira', 'yoli', 'jessica',
  'lismar', 'sol', 'nayibell', 'fabiola', 'priscila', 'manuela', 'andrea',
  'ennis', 'ana', 'verónica', 'veronica', 'yusbeth', 'yari', 'paola', 'vanessa',
  'naye', 'ana', 'reina', 'isabella', 'yosseany', 'georgette', 'catherine',
  'ivette', 'oljandrys', 'yngrid', 'barbara', 'leonardo', 'sophi', 'sophie',
  'karianna', 'vanessa', 'vicky', 'sofia', 'emilia', 'lismert', 'gaby', 'lois',
  'geral', 'leonor', 'loreana', 'NAYARETH', 'nayareth', 'dianita', 'sophia',
  'andreina', 'valentina', 'josiany', 'yenni', 'fabiola', 'eiry', 'eiry',
  'patricia', 'aliferceci', 'nao', 'nayareth', 'caro', 'erika', 'ana', 'eiry',
  'patricia', 'alci', 'coromoto', 'bethania', 'dayani', 'alicia', 'anneliz',
  'nathalie', 'janeth', 'andreina', 'marivic', 'danny', 'paola', 'carla',
  'paola', 'aneliza', 'audry', 'nakari', 'hoglys', 'lucy', 'maria', 'maría',
  'franyelis', 'nilda', 'yancy', 'kory', 'elizabeth', 'isy', 'nina', 'paola',
  'edith', 'nela', 'nayaly', 'alfonsina', 'maría', 'maría', 'gabriela', 'od',
  'yesenia', 'dakari', 'andrea', 'nicole', 'tania', 'adrielys', 'yolimar',
  'grecia', 'jacqueline', 'isabel', 'dleiderman', 'conceta', 'carmen', 'erianny',
  'kary', 'margareth', 'luisianys', 'narli', 'áfrica', 'africa', 'francys',
  'normalia', 'valentina', 'angeles', 'sosire', 'karla', 'salomé', 'salome',
  'nailit', 'soraima', 'joriannis', 'daniela', 'lisbeth', 'valentina', 'euny',
  'enyeli', 'barroso', 'costanza', 'daniela', 'zol', 'dali', 'ana', 'albany',
  'mariali', 'scarlet', 'francis', 'valeria', 'génesis', 'genesis', 'katy',
  'jennifer', 'andor', 'dayana', 'gregory', 'rita', 'yrailyn', 'dulce', 'pao',
  'andrea', 'rocío', 'rocio', 'mineli', 'sam', 'mayorxy', 'niza', 'juliany',
  'yeli', 'aleja', 'mirian', 'amozandra', 'delianis', 'graemi', 'vanessa',
  'daniela', 'norelis', 'leudys', 'sol', 'daniela', 'floriana', 'angelba',
  'delianis', 'gabriela', 'karla', 'gabriela', 'yineth', 'frebellys', 'greta',
  'vanessa', 'genesis', 'majo', 'alvimar', 'kyrenia', 'yosemyn', 'flor',
  'francys', 'vivi', 'lily', 'morella', 'marialejandra', 'victoria', 'ceci',
  'rosalejandra', 'alejandra', 'marian', 'yrene', 'aslyn', 'melissa', 'maria',
  'maría', 'junior', 'yenni', 'mariana', 'flor', 'gleiccy', 'mariu', 'eliana',
  'kreiza', 'ana', 'raisa', 'loreana', 'yexiger', 'eli', 'liliana', 'anita',
  'jorgelina', 'david', 'veronica', 'verónica', 'yari', 'nathalie', 'valeria',
  'yuriher', 'maría', 'maría', 'ori', 'jennifer', 'gabrila', 'gabriela',
  'ori', 'josselin', 'mariangel', 'maria', 'maría', 'francia', 'leonardo',
  'verónica', 'veronica', 'doly', 'ale', 'desiree', 'maria', 'maría', 'willianys',
  'stefani', 'silvana', 'katherine', 'maría', 'maría', 'rose', 'sthefania',
  'morella', 'angely', 'alicia', 'ivanella', 'ucrania', 'migreilys', 'amozandra',
  'maria', 'maría', 'jhoscarlis', 'nayareth', 'genesis', 'ivette', 'ysaunil',
  'maría', 'maría', 'daniela', 'andrea', 'normarys', 'clorimar', 'ana', 'katherine',
  'andrea', 'yessenia', 'eva', 'arelys', 'astrid', 'miguel', 'virginia', 'marivic',
  'elisy', 'elsy', 'sabrina', 'miriam', 'michelle', 'aliferceci', 'alejandra',
  'karlex', 'crismel', 'luz', 'alimar', 'marina', 'arnalibeth', 'juliany',
  'eva', 'ybol', 'chicha', 'fiorella', 'valeria', 'janes', 'alessandra', 'gigi',
  'angela', 'rose', 'janeth', 'nathali', 'neyba', 'lis', 'paola', 'emilis',
  'yingris', 'sandra', 'marieth', 'dorus', 'yelitza', 'beatriz', 'orianna',
  'francis', 'fabiola', 'daniela', 'jacobo', 'fabiola', 'kisie', 'veronica',
  'marian', 'ana', 'yessika', 'wilermys', 'zena', 'kristian', 'barbara',
  'theisy', 'lyly', 'angela', 'marcos', 'marysol', 'normarys', 'carmen',
  'jeisy', 'carmen', 'ana', 'genesis', 'genessys', 'elizabeth', 'stela',
  'oriana', 'oriana', 'oriana', 'angie', 'stela', 'oriana'
]);

// Names that start with female titles or nicknames
function isFemaleName(name: string): boolean {
  if (!name) return false;
  const clean = name.trim().toLowerCase();

  if (clean.includes('sra') || clean.includes('sra.') || clean.includes('señora') || clean.includes('senora')) {
    return true;
  }
  if (clean.includes('(cotizacion') || clean.includes('cotización') || clean.includes('vecinos')) {
    return false;
  }

  // Check first token
  const firstToken = clean.split(/\s+/)[0].replace(/[^a-záéíóúñ]/gi, '');
  if (FEMALE_NAMES.has(firstToken)) return true;

  // Check second token if first is e.g. "Sra", "Dra", "Ma", "Maria"
  const tokens = clean.split(/\s+/);
  if (tokens.length > 1) {
    const secondToken = tokens[1].replace(/[^a-záéíóúñ]/gi, '');
    if (FEMALE_NAMES.has(secondToken)) return true;
  }

  return false;
}

// Common male names list to check
const MALE_NAMES = new Set([
  'jose', 'josé', 'alberto', 'david', 'rafael', 'enderson', 'anthony', 'gean',
  'joel', 'jairo', 'john', 'simón', 'simon', 'francisco', 'eduardo', 'ricardo',
  'carlos', 'steven', 'miguel', 'fran', 'junior', 'christopher', 'abraham',
  'nelson', 'moises', 'moisés', 'alvaro', 'álvaro', 'belisario', 'anthony',
  'peter', 'edgard', 'henry', 'emmanuel', 'ingger', 'ronald', 'manuel',
  'gregory', 'daniel', 'jesús', 'jesus', 'jonder', 'gustavo', 'arquímedes',
  'arquimedes', 'leonardo', 'yaditson', 'jhorby', 'jhonny', 'erick', 'juan',
  'alessandro', 'raymond', 'ross', 'julio', 'paola', 'carlos', 'ricardo',
  'franklin', 'emmanuel', 'kelvin', 'servando', 'josé', 'jose', 'edward',
  'fabiola', 'dmitrii', 'pedro', 'gabriel', 'bryant', 'elio', 'luis', 'jorge',
  'ivan', 'jhosse', 'giovanni', 'esteban', 'larry', 'norys', 'etdriana',
  'jesus', 'ruben', 'domingo', 'alex', 'rafael', 'adonis', 'gio', 'josvic',
  'gipsson', 'dakari', 'gustavo', 'julio', 'carlos', 'frank', 'dennis',
  'bryan', 'osdelio', 'javier', 'josué', 'josue', 'viacheslav', 'carlos',
  'victor', 'víctor', 'mikael', 'dmitrii', 'guillermo', 'ramon', 'ramón',
  'oscar', 'óscar', 'ezequiel', 'victor', 'víctor', 'jose', 'josé', 'axel',
  'hector', 'héctor', 'migue', 'william', 'wilibardo', 'bryant', 'john',
  'nicolas', 'nicolás', 'ollarves', 'abdil', 'armando', 'daniel', 'roberto',
  'steve', 'santiago', 'jack', 'arbis', 'josbert', 'jose', 'josé', 'andres',
  'andrés', 'd’santiago', 'luis', 'issajar', 'eladio', 'jesus', 'jesús',
  'miguel', 'carlos', 'arnaldo', 'miguel', 'josé', 'josé', 'rosmary',
  'enyerson', 'moises', 'héctor', 'hector', 'carlos', 'norvi', 'juan',
  'pedro', 'francisco', 'gabriel', 'adrian', 'adrián', 'alfredo', 'ulises',
  'endrina', 'andrea', 'angel', 'ángel', 'nestor', 'néstor', 'cesar', 'césar',
  'ronni', 'andrés', 'andres', 'victor', 'víctor', 'yoleida', 'cesar', 'césar',
  'alberto', 'juan', 'julio', 'abilio', 'luis', 'david', 'jose', 'josé',
  'kristian', 'jose', 'josé', 'luis', 'giuliana', 'josué', 'josue', 'eduardo',
  'edward', 'josefina', 'karen', 'maybran', 'ydes', 'angela', 'marco',
  'alexander', 'edward', 'miguel', 'ivan', 'jorgelino', 'barroso', 'josé',
  'josé', 'pastor', 'od', 'ruth', 'josé', 'josé', 'deiby', '𝙅𝙪𝙖𝙣', 'juan',
  'kory', 'juan', 'willianys', 'hoglys', 'juan', 'jhon', 'elias', 'elías',
  'alifer', 'jose', 'josé', 'lauri', 'jorge', 'elisa', 'estefanny', 'juan',
  'fredy', 'samuel', 'mayerlin', 'dania', 'daniel', 'robert', 'samed',
  'leonardo', 'rodbrant', 'franye', 'cesar', 'césar', 'arelys', 'fabiola',
  'aimara', 'alexander', 'daniela', 'keiver', 'ender', 'angel', 'ángel',
  'wilson', 'josé', 'josé', 'david', 'candy', 'mariana', 'david', 'candy',
  'samed', 'rafael', 'mari', 'vecinos', 'miguel', 'william', 'wilibardo',
  'bryant', 'john', 'rafael', 'ollarves', 'santiago', 'eliezar', 'eliezer',
  'nicolas', 'nicolás', 'abdil', 'jacqueline', 'patrizia', 'elisy', 'elsy',
  'vanessa', 'ana', 'maría', 'maria', 'mayerlin', 'sarah', 'nakari',
  'yennifer', 'od', 'carmine', 'armando', 'daniel', 'filomena', 'armando',
  'frank', 'william', 'ruben', 'rubén', 'andrea', 'carilyn', 'sol', 'maikel',
  'luis', 'lorenzo', 'carlos', 'viacheslav', 'andrea', 'armando', 'vecinos',
  'luis', 'alecia', 'vecinos', 'luis', 'cesar', 'césar', 'rebe', 'jalma',
  'nelemar', 'rossanna', 'john', 'damaris', 'getzi', 'yennifer', 'adrielys',
  'angeles', 'alvaro', 'álvaro', 'charles', 'john', 'anaida', 'nestor', 'néstor',
  'pedro', 'brenda', 'maría', 'greta', 'mayra', 'andre', 'andrea', 'julieta',
  'eladio', 'jesus', 'jesús', 'miguel', 'carlos', 'arnaldo', 'miguel',
  'jose', 'josé', 'mavi', 'rosmary', 'enyerson', 'anick', 'moises', 'moisés',
  'héctor', 'hector', 'carlos', 'norvi', 'margarita', 'victoria', 'juan',
  'pedro', 'rosana', 'francisco', 'omaira', 'virgy', 'clarelys', 'gabriel',
  'adrian', 'adrián', 'alfredo', 'endrina', 'andrea', 'andrea', 'angel', 'ángel',
  'nestor', 'néstor', 'cesar', 'césar', 'ronni', 'andrés', 'andres', 'victor',
  'víctor', 'yoleida', 'cesar', 'césar', 'alberto', 'juan', 'julio', 'abilio',
  'luis', 'david', 'jose', 'josé', 'kristian', 'jose', 'josé', 'luis', 'giuliana',
  'josué', 'josue', 'eduardo', 'edward', 'sophia', 'josefina', 'karen',
  'veruschka', 'maybran', 'ydes', 'angela', 'marco', 'alexander', 'edward',
  'miguel', 'ivan', 'jorgelino', 'barroso', 'josé', 'josé', 'pastor', 'od',
  'ruth', 'josé', 'josé', 'deiby', '𝙅𝙪𝙖𝙣', 'juan', 'kory', 'juan', 'willianys',
  'hoglys', 'juan', 'jhon', 'elias', 'elías', 'alifer', 'jose', 'josé', 'lauri',
  'jorge', 'elisa', 'estefanny', 'juan', 'fredy', 'samuel', 'mayerlin',
  'dania', 'daniel', 'robert', 'samed', 'leonardo', 'rodbrant', 'franye',
  'cesar', 'césar', 'arelys', 'fabiola', 'aimara', 'alexander', 'daniela',
  'keiver', 'ender', 'angel', 'ángel', 'wilson', 'mary', 'josé', 'josé',
  'david', 'candy', 'mariana', 'david', 'candy', 'samed', 'rafael', 'mari',
  'vecinos', 'miguel', 'william', 'wilibardo', 'bryant', 'john', 'rafael',
  'ollarves', 'santiago', 'eliezer', 'nicolas', 'nicolás', 'abdil', 'jacqueline',
  'patrizia', 'elisy', 'elsy', 'vanessa', 'ana', 'maría', 'maria', 'mayerlin',
  'sarah', 'nakari', 'yennifer', 'od', 'carmine', 'armando', 'daniel',
  'filomena', 'armando', 'frank', 'william', 'ruben', 'rubén', 'andrea',
  'carilyn', 'sol', 'maikel', 'luis', 'lorenzo', 'carlos', 'viacheslav',
  'andrea', 'armando', 'vecinos', 'luis', 'alecia', 'vecinos', 'luis', 'cesar',
  'césar', 'rebe', 'jalma', 'nelemar', 'rossanna', 'john', 'damaris', 'getzi',
  'yennifer', 'adrielys', 'angeles', 'alvaro', 'álvaro', 'charles', 'john',
  'anaida', 'nestor', 'néstor', 'pedro', 'brenda', 'maría', 'greta', 'mayra',
  'andre', 'andrea', 'julieta', 'charles', 'paredes', 'bárbara', 'barbara',
  'juan', 'vanessa', 'virgy', 'francis', 'priscila', 'oscar', 'óscar',
  'yaliska', 'miranda', 'freddy', 'vero', 'eleazar', 'iselen', 'nury',
  'jose', 'josé', 'ligia', 'karen', 'ivette', 'kimberlyng', 'gabriel', 'luis',
  'sthephany', 'andreína', 'andreina', 'oscary', 'maria', 'maría', 'maría',
  'armando', 'luis', 'graciela', 'efrain', 'evelyn', 'marisol', 'angelica',
  'emanuel', 'cindy', 'albany', 'daniel', 'aneliza', 'krelina', 'ginette',
  'barbara', 'jhona', 'barbara', 'jhon', 'eduardo', 'adriana', 'sayi', 'edith',
  'cucho', 'jaderline', 'davianna', 'ana', 'yandhira', 'valentina', 'mariana',
  'edgar', 'nai', 'javier', 'isveliss', 'crisalida', 'barbara', 'michelle',
  'rafael', 'andreina', 'maria', 'maría', 'vanesa', 'eliangel', 'ruth',
  'elizabeth', 'jesús', 'jesus', 'francis', 'silvia', 'vecinos', 'vecinos',
  'vecinos', 'vecinos', 'liliana', 'vecinos', 'yulimar', 'andrea', 'elba',
  'carla', 'patricia', 'genesis', 'deiby', 'louisse', 'gabriela', 'jennifer',
  'harut', 'manuel', 'victor', 'víctor', 'alexandra', 'mairyn', 'erika',
  'hellen', 'ygma', 'yuli', 'barbara', 'yani', 'yuribeth', 'viviana', 'roberto',
  'teresa', 'shasira', 'cathryn', 'andreina', 'glenda', 'mariangel', 'glenda',
  'sol', 'scarleth', 'bruno', 'patricia', 'nicole', 'carla', 'daniela', 'francis',
  'lindsy', 'bianca', 'angeles', 'enmanuel', 'yacenia', 'ana', 'maría', 'maria',
  'jhusgrey', 'julio', 'carlos', 'leonela', 'alice', 'alexander', 'yomaira',
  'ane', 'josé', 'josé', 'jocarli', 'romi', 'yessi', 'daniel', 'gabriela',
  'francis', 'kelly', 'kat', 'sergio', 'yennifer', 'jennifer', 'fran', 'solecito',
  'carmen', 'luci', 'roger', 'anick', 'jessica', 'sol', 'lismar', 'mayerlin',
  'albani', 'karly', 'carlos', 'kristian', 'andreina', 'edwar', 'jhonnatta',
  'loreana', 'gregory', 'heydi', 'inés', 'ines', 'theisy', 'yhonni', 'mercedes',
  'sofia', 'luisiana', 'maria', 'maría', 'ginella', 'samuel', 'ivan', 'javier',
  'zoi', 'marisol', 'adolfo', 'vanessa', 'yelitza', 'paola', 'jhusgrey',
  'ericson', 'priscila', 'belkys', 'rebeca', 'miranda', 'krelina', 'fiorella',
  'eusebio', 'darwuin', 'gabriel', 'jesus', 'jesús', 'astrid', 'alexander',
  'oriana', 'armando', 'jesús', 'jesus', 'arianna', 'mela', 'jesús', 'jesus',
  'jeams', 'nella', 'mayra', 'anyismar', 'alithea', 'edgar', 'manuel', 'liliana',
  'damelys', 'alvaro', 'álvaro', 'edgardo', 'mhaida', 'issajar', 'roberto',
  'carlos', 'maria', 'maría', 'pierre', 'daniel', 'yadira', 'jacqueline',
  'rebe', 'fabiola', 'eva', 'andrea', 'caro', 'dleiderman', 'cesar', 'césar',
  'maría', 'maría', 'fiorella', 'nakari', 'jonathan', 'victoria', 'gleiccy',
  'mariu', 'eliana', 'kreiza', 'ana', 'juancarlos', 'raisa', 'loreana', 'yexiger',
  'eli', 'liliana', 'anita', 'leonardo', 'dixon', 'jorgelina', 'jose', 'josé',
  'david', 'roberto', 'Igle', 'charles', 'yari', 'nathalie', 'valeria', 'yuriher',
  'maría', 'maría', 'alfonso', 'aaron', 'ivan', 'ori', 'jennifer', 'gabrila',
  'gabriela', 'ori', 'josselin', 'jhon', 'adolfo', 'jesus', 'jesús', 'maria',
  'maría', 'maria', 'maría', 'francia', 'leonardo', 'simón', 'simon', 'ray',
  'yoxmary', 'delfin', 'delfín', 'verónica', 'veronica', 'doly', 'ale', 'desiree',
  'armando', 'maria', 'maría', 'willianys', 'jeremy', 'franye', 'stefani',
  'kenneth', 'jonathan', 'ruben', 'rubén', 'silvana', 'katherine', 'maría',
  'maría', 'jose', 'josé', 'alberto', 'stefani', 'sthefania', 'jesús', 'jesus',
  'wilman', 'dilbanis', 'morella', 'angely', 'alicia', 'ivanella', 'ucrania',
  'migreilys', 'oswaldo', 'edwar', 'fabiola', 'kristian', 'maria', 'maría',
  'oswaldo', 'lily', 'damelys', 'jhoscarlis', 'nayareth', 'genesis', 'ivette',
  'ysaunil', 'maría', 'maría', 'daniela', 'andrea', 'daniel', 'jesus', 'jesús',
  'normarys', 'migue', 'hernan', 'jose', 'josé', 'clorimar', 'ana', 'roberto',
  'adamo', 'edwar', 'katherine', 'andrea', 'yessenia', 'eva', 'wilman', 'arelys',
  'astrid', 'miguel', 'pablo', 'virginia', 'marivic', 'armando', 'ivan', 'elisy',
  'elsy', 'oscar', 'óscar', 'sabrina', 'miriam', 'michelle', 'aliferceci',
  'alejandra', 'karlex', 'crismel', 'luz', 'alimar', 'deivis', 'marina',
  'arnalibeth', 'juliany', 'luis', 'eva', 'ybol', 'wilfredo', 'andres', 'andrés',
  'chicha', 'dario', 'daría', 'fiorella', 'mario', 'valeria', 'janes', 'gigi',
  'angela', 'tomas', 'tomás', 'rose', 'janeth', 'nathali', 'neyba', 'lis',
  'paola', 'emilis', 'yingris', 'sandra', 'josé', 'josé', 'marieth', 'dorus',
  'kristian', 'yelitza', 'beatriz', 'cucho', 'michel', 'ray', 'orianna',
  'francis', 'gustavo', 'daniela', 'carlos', 'jacobo', 'fabiola', 'kisie',
  'veronica', 'johansson', 'bryant', 'marian', 'ana', 'yessika', 'diego',
  'wilermys', 'axel', 'gregorio', 'zena', 'césar', 'cesar', 'kristian',
  'césar', 'cesar', 'moises', 'moisés', 'barbara', 'alexis', 'theisy',
  'lyly', 'daniel', 'angela', 'marcos', 'simón', 'simon', 'bryant', 'marysol',
  'conrado', 'victor', 'víctor', 'andres', 'andrés', 'jorge', 'jeisy', 'carmen',
  'ana', 'leandro', 'henry', 'nathalie', 'genesis', 'claudio', 'william',
  'pastor', 'fran', 'nicolás', 'nicolas', 'victor', 'víctor', 'angie', 'stela',
  'oriana', 'marcos', 'gregorio', 'carlos'
]);

function isMaleName(name: string): boolean {
  if (!name) return false;
  const clean = name.trim().toLowerCase();
  const firstToken = clean.split(/\s+/)[0].replace(/[^a-záéíóúñ]/gi, '');
  return MALE_NAMES.has(firstToken);
}

// Full text parsing
export async function seedCSVData() {
  console.log('🚀 Iniciando la carga de datos del reporte...');

  // Drivers to ensure in user database with role "repartidor"
  const driversToEnsure = [
    { username: 'oscar', name: 'Oscar', role: 'repartidor' },
    { username: 'victor', name: 'Victor', role: 'repartidor' },
    { username: 'joseangel', name: 'Jose Angel', role: 'repartidor' },
    { username: 'ezequiel', name: 'Ezequiel', role: 'repartidor' },
    { username: 'axel', name: 'Axel', role: 'repartidor' },
  ];

  for (const d of driversToEnsure) {
    await prisma.user.upsert({
      where: { username: d.username },
      update: { name: d.name, role: d.role },
      create: {
        username: d.username,
        password_hash: hashPassword('123456'),
        name: d.name,
        role: d.role,
      },
    });
  }

  // Raw CSV Lines provided by user
  const rawData = [
    `PED-7B8B4B19,2026-08-08,15:49,Genesis Guerra,+584243676835,Cacao denso MED x1,,pendiente,15.67,11857.62,3.67,`,
    `PED-BD531CDE,2026-08-08,15:46,Maryam sánchez,+584128560980,Clásico MED x1,Oscar,en_camino,15.54,11759.25,3.54,`,
    `PED-44B6936F,2026-08-08,15:39,Amalia Keudari,+584144783565,Clásico IND x1,Victor,en_camino,7.5,5675.31,1.5,`,
    `PED-4D212760,2026-08-08,15:37,José,+573142482530,Cacao denso MED x1,Jose Angel,en_camino,14.91,11282.52,2.91,`,
    `PED-8FC25F5D,2026-08-08,15:35,Alberto Gil,+5869409959,Clásico GRD x1,,pendiente,25.5,19296.06,1.5,"PARA MAÑANA A LAS 10.30AM\nDejar en vigilancia del edificio"`,
    `PED-3E331702,2026-08-08,15:23,Steff Ferrer,+584124563406,Clásico MED x1,Oscar,entregado,13.55,10253.4,1.55,`,
    `PED-1D0B23E1,2026-08-08,15:15,Aída Rodríguez,+584124328362,Clásico MED x1,Pickup en tienda,pendiente,12.0,9080.5,0,`,
    `PED-F1648729,2026-08-08,15:15,Norexys García,+584120340813,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-14F91F75,2026-08-08,15:05,David,+584120326625,"Clásico IND x2, Cacao denso IND x2",Pickup en tienda,entregado,24.0,18161.0,0,`,
    `PED-DB19465B,2026-08-08,14:56,Daniela Delgado,+584243790925,Clásico IND x1,Victor,entregado,8.15,6167.17,2.15,Casa Italia`,
    `PED-AA0BF3ED,2026-08-08,14:55,Rafael,+584127549923,Cacao denso MED x1,Victor,entregado,13.5,10215.56,1.5,`,
    `PED-AAC36399,2026-08-08,14:53,Virgy ,+584121795528,Cacao denso MED x1,Jose Angel,entregado,13.5,10215.56,1.5,`,
    `PED-0DB8E643,2026-08-08,14:43,Ana Uzcategui,+584243317120,Clásico MED x1,Oscar,entregado,14.65,11085.78,2.65,`,
    `PED-7EACE941,2026-08-08,14:42,Flor Rincón,+584149452815,Clásico MED x1,Jose Angel,entregado,14.94,11305.22,2.94,`,
    `PED-2AF5B747,2026-08-08,14:39,Yolanda Macedo ,+584143446915,Clásico MED x1,Victor,entregado,16.08,12167.87,4.08,`,
    `PED-DB5104E5,2026-08-08,14:37,Endrina Beaumont,+584128991802,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-2C033395,2026-08-08,14:30,Eli,+584145981954,Clásico MED x1,Pickup en tienda,pendiente,12.0,9080.5,0,`,
    `PED-9B3AEA55,2026-08-08,14:20,Michiko Amano,+584127534917,Clásico MED x1,Oscar,entregado,13.5,10215.56,1.5,`,
    `PED-29864749,2026-08-08,14:06,Armando Ditho,+584243461802,"Cacao denso MED x1, Cacao denso GRN x1",,pendiente,38.0,28754.92,2.0,Hotel Caroni Ditho A LAS 12 DEL MEDIODIA`,
    `PED-1959D801,2026-08-08,14:06,Alexandra,+584241312395,Cacao denso MED x1,Jose Angel,entregado,13.82,10457.71,1.82,`,
    `PED-8A8E6ED8,2026-08-08,13:50,Krelina,+584128209737,Cacao denso IND x1,Oscar,entregado,7.5,5675.31,1.5,`,
    `PED-9DC823AC,2026-08-08,13:45,(Cotizacion sin cliente),,Clásico MED x1,,cotizacion,16.33,12357.05,4.33,`,
    `PED-D0BFE81D,2026-08-08,13:44,Enderson Leonel,+584140522846,Clásico IND x1,Oscar,entregado,7.5,5675.31,1.5,LUXOR ES EL CARNICERO`,
    `PED-02B00775,2026-08-08,13:38,Andrea Romero,+584243510784,Clásico MED x1,Victor,entregado,16.11,12190.57,4.11,`,
    `PED-30FA0900,2026-08-08,13:32,Sailin Goncalves,+584123408141,Clásico MED x1,Victor,entregado,16.63,12584.06,4.63,`,
    `PED-20529312,2026-08-08,13:31,Antonella López,+584248682209,Clásico GRD x1,Jose Angel,entregado,26.15,19787.92,2.15,`,
    `PED-4FFE6A54,2026-08-08,13:18,Anthony Ladera,+584243270124,Clásico MED x1,Jose Angel,entregado,13.5,10215.56,1.5,`,
    `PED-21B275D4,2026-08-08,13:17,Gean,+584127769459,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-5853E60A,2026-08-07,20:52,Joel,+584144772712,Clásico MED x1,Oscar,entregado,13.5,10215.56,1.5,`,
    `PED-FAB1ADC4,2026-08-07,20:11,Claudia,+584143929940,Clásico MED x1,,pendiente,13.5,10215.56,1.5,PARA EL DOMINGO`,
    `PED-858CA946,2026-08-07,20:09,Jairo Torin,+584144939874,"Clásico IND x1, Cacao denso IND x1",Victor,entregado,14.29,10813.36,2.29,`,
    `PED-0F9B5275,2026-08-07,20:07,John,+584144146701,Clásico MED x3,Pickup en tienda,entregado,36.0,27241.5,0,`,
    `PED-13207B3C,2026-08-07,19:55,Simón Bolívar,+584262345299,Clásico MED x1,Oscar,entregado,13.5,10215.56,1.5,`,
    `PED-9E1EA12D,2026-08-07,19:52,Grecia,+584128979122,Clásico GRD x1,,pendiente,26.88,20340.32,2.88,`,
    `PED-EB02BDE4,2026-08-07,19:38,Francisco carvallo,+584243357140,Cacao denso GRN x1,Jose Angel,entregado,25.62,19386.87,1.62,`,
    `PED-503EEA82,2026-08-07,19:32,Miranda Diaz Gomez,+584243199499,Clásico MED x2,Victor,entregado,29.0,21944.54,5.0,`,
    `PED-11B05064,2026-08-07,19:23,Stephanie Martínez,+584121445880,Clásico IND x1,Oscar,entregado,9.9,7491.41,3.9,`,
    `PED-1BE0A4ED,2026-08-07,19:14,Eduardo,+584128929201,"Clásico IND x1, Cacao denso IND x1",Oscar,entregado,15.27,11554.94,3.27,`,
    `PED-35FAEB2B,2026-08-07,19:00,Marietta Pimenta,+584124138903,Cacao denso MED x1,Victor,entregado,13.53,10238.26,1.53,`,
    `PED-2664FF16,2026-08-07,18:59,Merlyn,+584243038138,Clásico GRD x1,,pendiente,28.5,21566.19,4.5,EL AVISA EL DELIVERY`,
    `PED-5ED92DDC,2026-08-07,18:31,Ricardo Araujo,+584144505162,Cacao denso MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-A59204D2,2026-08-07,18:10,Vecinos,+584120000000,Cacao denso MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-37F57539,2026-08-07,18:02,Carlos Moreno,+584124572115,Cacao denso IND x1,Jose Angel,entregado,6.4,4842.93,0.4,EDIFICIOS FRENTE AL CIRCULO MILITAR LA BARRACA`,
    `PED-1537832F,2026-08-07,18:00,Steven,+584128891759,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-097C0667,2026-08-07,17:34,Grecia Godoy,+584120987372,Clásico MED x1,Oscar,entregado,13.5,10215.56,1.5,`,
    `PED-167698DD,2026-08-07,17:26,Vecinos,+584120000000,Cacao denso IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-A2578544,2026-08-07,17:25,Miguel vivas,+584124063351,Clásico MED x1,Jose Angel,entregado,14.1,10669.59,2.1,`,
    `PED-4C2D9442,2026-08-07,17:17,Fran Salinas,+584243407663,Cacao denso MED x1,Oscar,entregado,13.5,10215.56,1.5,Al lado de Hortifresca av bermudez`,
    `PED-900D2643,2026-08-07,17:16,Vecinos,+584120000000,Cacao denso MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-1BDE5AF3,2026-08-07,17:13,Carliz Díaz,+584243161553,Cacao denso MED x1,Victor,entregado,15.83,11978.69,3.83,`,
    `PED-392E0A32,2026-08-07,17:11,Vecinos,+584120000000,Cacao denso MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-BFC5963A,2026-08-07,17:08,Junior Arraiz,+584243371221,Cacao denso MED x1,Jose Angel,entregado,13.5,10215.56,1.5,`,
    `PED-2C1F0142,2026-08-07,17:05,Vecinos,+584120000000,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-D0C8E007,2026-08-07,17:03,Leonor Salcedo,+584243310903,Clásico MED x1,Pickup en tienda,pendiente,12.0,9080.5,0,`,
    `PED-3713045F,2026-08-07,16:42,Christopher,+584122148192,Clásico IND x1,Victor,entregado,10.07,7620.05,4.07,`,
    `PED-FF36A332,2026-08-07,16:37,Isabel Vera,+584145890506,Clásico MED x1,Jose Angel,entregado,13.62,10306.37,1.62,`,
    `PED-2C939A0A,2026-08-07,16:27,María Rauseo,+584144469450,Clásico MED x1,Oscar,entregado,17.5,13242.4,5.5,`,
    `PED-96C1DB3C,2026-08-07,16:10,Ysa,+584243142698,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-71A7794F,2026-08-07,16:08,Ydanys Contreras,+584144779990,Clásico MED x1,Victor,entregado,16.27,12311.64,4.27,`,
    `PED-9DCE115D,2026-08-07,16:06,Sofia Lopez ,+584124563182,Cacao denso GRN x1,Oscar,entregado,25.5,19296.06,1.5,`,
    `PED-55423B8E,2026-08-07,15:52,Vecinos,+584120000000,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-2DB7F758,2026-08-07,15:50,Yorgelis Safo,+584144698254,Cacao denso IND x1,Jose Angel,entregado,7.56,5720.71,1.56,`,
    `PED-1E8FC59C,2026-08-07,15:41,Abraham Olmedo,+584243702777,Cacao denso MED x1,Oscar,entregado,13.92,10533.38,1.92,`,
    `PED-D8D324C3,2026-08-07,15:40,Lilianggye Ramírez,+584243355853,Clásico GRD x1,Pickup en tienda,pendiente,24.0,18161.0,0,PARA EL DOMINGO O LUNES OJOOOOOOO`,
    `PED-709901BE,2026-08-07,15:36,Nakari,+584243101369,Clásico GRD x1,Victor,entregado,27.48,20794.34,3.48,`,
    `PED-E40373FD,2026-08-07,15:23,nelson rojas,+584243096678,Cacao denso MED x1,Oscar,entregado,13.82,10457.71,1.82,`,
    `PED-4DAC29AF,2026-08-07,15:22,Loreana Castillo,+584145903928,Clásico MED x1,Jose Angel,entregado,13.6,10291.23,1.6,`,
    `PED-DA2ECCE1,2026-08-07,15:08,Nikki,+584243411378,Cacao denso IND x1,Victor,entregado,7.61,5758.55,1.61,`,
    `PED-1D220318,2026-08-07,14:52,Mikael Rey,+584243207812,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-88159480,2026-08-07,14:21,Steven,+584128891759,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-229A6D5B,2026-08-07,14:15,Moises Cliente,+584120599539,Clásico GRD x2,Oscar,entregado,49.5,37457.06,1.5,Terra Norte frente a la iglesia por el estacionamiento`,
    `PED-D0BE5B52,2026-08-07,13:58,Alvaro,+584149197047,Clásico MED x2,Jose Angel,entregado,28.33,21437.55,4.33,`,
    `PED-55AE6CF2,2026-08-07,13:57,Belisario,+584145431264,Cacao denso MED x1,Oscar,entregado,13.5,10215.56,1.5,Al frente de la plaza Bicentenaria en el instituto de Senologia de Aragua. (ISENA)`,
    `PED-90875F61,2026-08-07,13:55,Vecinos,+584120000000,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-B4E1ACF4,2026-08-07,13:43,Vecinos,+584120000000,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-410408A8,2026-08-07,13:30,Ivana Contreras,+584124354456,Clásico MED x1,Oscar,entregado,13.79,10435.01,1.79,`,
    `PED-BBEC242C,2026-08-07,13:28,Vecinos,+584120000000,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-583E3E57,2026-08-07,13:20,Nesmar Zerpa,+584144638151,Cacao denso MED x1,Victor,entregado,13.5,10215.56,1.5,`,
    `PED-4032814A,2026-08-07,11:52,Vecinos,+584120000000,"Clásico IND x1, Cacao denso IND x1, Clásico MED x2",Pickup en tienda,entregado,36.0,27241.5,0,`,
    `PED-2B1A8702,2026-08-06,20:14,Joibimar Sosa,+34678619115,Clásico MED x1,Pickup en tienda,pendiente,12.0,9080.5,0,`,
    `PED-A633A837,2026-08-06,20:05,Vecinos,+584120000000,Cacao denso IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-F00640DF,2026-08-06,19:47,Peter García,+584243338665,Cacao denso MED x1,Jose Angel,entregado,15.68,11865.19,3.68,`,
    `PED-D7C5E6D1,2026-08-06,19:47,Mary Ruiz ,+584141492807,Clásico MED x1,Victor,entregado,14.9,11274.95,2.9,`,
    `PED-A750A321,2026-08-06,19:29,nelson rojas,+584243096678,Cacao denso IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-853D87AA,2026-08-06,19:10,Vecinos,+584120000000,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-1FFD6CF7,2026-08-06,18:42,Vecinos,+584120000000,Cacao denso IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-1423E6B5,2026-08-06,18:08,Vecinos,+584120000000,Cacao denso MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-E88E5425,2026-08-06,17:59,Jorge Rios,+584144696983,Clásico GRD x1,Pickup en tienda,entregado,24.0,18161.0,0,`,
    `PED-95946454,2026-08-06,17:53,Edgard escalona,+584243273186,"Cacao denso MED x1, Cacao denso IND x1",Jose Angel,entregado,19.83,15005.53,1.83,EL INDIVIDUAL DE CACAO DENSO QUE DIGA LA BOLSA: FELIZ CUMPLEAÑOS.`,
    `PED-70C451EE,2026-08-06,17:22,Daniel Mendez,+584144936273,Cacao denso IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-E18A3D99,2026-08-06,17:20,Henry Tausk,+584144935483,Clásico IND x1,Victor,entregado,7.84,5932.59,1.84,`,
    `PED-EA4DFD48,2026-08-06,17:16,Emmanuel,+584120473902,Cacao denso MED x1,Oscar,entregado,15.58,11789.52,3.58,`,
    `PED-4AFE1A96,2026-08-06,17:06,Ingger Tapia,+58888,Clásico MED x1,Victor,entregado,13.5,10215.56,1.5,EL AVISA`,
    `PED-3E4CE8CC,2026-08-06,17:01,Vanessa,+584124929011,Clásico IND x2,Jose Angel,entregado,15.96,12077.06,3.96,Caña de Azúcar sector 6 bloque 11`,
    `PED-34B4C3C7,2026-08-06,16:56,Yormary Rojas,+584243447352,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-D6262906,2026-08-06,16:55,Mila,+584140495119,"Clásico MED x1, Cacao denso IND x1",Victor,entregado,20.21,15293.07,2.21,`,
    `PED-CD1A4C29,2026-08-06,16:51,Ronald Rubio,+584243403743,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-E868F579,2026-08-06,16:39,Gloria Pimentel,+584243696589,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-F12E2DCB,2026-08-06,16:26,Jennifer,+584243639253,Clásico IND x1,Oscar,entregado,7.5,5675.31,1.5,LAS AMERICAS`,
    `PED-9A125C6E,2026-08-06,16:22,Reina,+584145980701,Clásico MED x2,Jose Angel,entregado,27.0,20431.12,3.0,`,
    `PED-2546C6F7,2026-08-06,16:20,Yastnel,+584243034143,Clásico MED x1,Jose Angel,entregado,13.5,10215.56,1.5,`,
    `PED-CDC272F4,2026-08-06,16:16,Manuel Yepez,+584149453110,"Clásico MED x1, Cacao denso MED x1",Victor,entregado,26.06,19719.82,2.06,`,
    `PED-E4FD1DD4,2026-08-06,16:07,Vecinos,+584120000000,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-9CF3E6DA,2026-08-06,16:05,Vecinos,+584120000000,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-F31C6CD6,2026-08-06,15:57,Anyumar Romero,+584243700217,Cacao denso MED x1,Oscar,entregado,13.5,10215.56,1.5,`,
    `PED-DA44DF9C,2026-08-06,15:43,Vecinos,+584120000000,Cacao denso IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-8187B2D2,2026-08-06,15:43,Alexandra,+584243771372,Clásico MED x1,Jose Angel,entregado,14.52,10987.4,2.52,`,
    `PED-9007BF17,2026-08-06,15:41,Gregory Castillo,+584243615072,Cacao denso MED x1,Oscar,entregado,14.08,10654.45,2.08,`,
    `PED-651B2084,2026-08-06,15:40,Vecinos,+584120000000,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-D967743E,2026-08-06,15:40,Vecinos,+584120000000,Clásico MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-08BF67C3,2026-08-06,15:35,Daniel Cabral ,+574128961812,Cacao denso MED x1,Jose Angel,entregado,14.46,10942.0,2.46,`,
    `PED-243B8D68,2026-08-06,15:33,Jesús romero,+573202660179,Cacao denso MED x1,Oscar,entregado,13.5,10215.56,1.5,`,
    `PED-23FAA534,2026-08-06,15:30,Francisco carvallo,+584243357140,Clásico MED x1,Oscar,entregado,13.57,10268.53,1.57,PARA LAS 7 DE LA NOCHE!!!!`,
    `PED-F162CC9E,2026-08-06,15:26,Jonder,+584160419637,"Clásico IND x1, Cacao denso MED x1",Victor,entregado,21.29,16110.32,3.29,`,
    `PED-16257279,2026-08-06,15:17,Coromoto Montero,+584127336496,Cacao denso IND x1,Jose Angel,entregado,9.91,7498.98,3.91,`,
    `PED-0447747E,2026-08-06,15:00,Angelica,+584123457690,Clásico IND x1,Victor,entregado,7.5,5675.31,1.5,`,
    `PED-D5F20C1C,2026-08-06,14:55,Vecinos,+584120000000,Cacao denso IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`,
    `PED-E86C4617,2026-08-06,14:43,Claudia Miranda,+584127412753,Clásico MED x1,Oscar,entregado,14.12,10684.72,2.12,`,
    `PED-F3F9DC73,2026-08-06,14:27,Teresa,+584149478032,Cacao denso MED x1,Victor,entregado,14.13,10692.29,2.13,MERCANTIL DE LA AVENIDA ARAGUA`,
    `PED-26374BD8,2026-08-06,14:24,Gustavo Garcés,+584121992480,Clásico MED x1,Jose Angel,entregado,14.4,10896.6,2.4,Araguama Dividive 23`,
    `PED-D7F97346,2026-08-06,14:11,Ambar Castro,+584243300974,Cacao denso MED x1,Pickup en tienda,entregado,12.0,9080.5,0,`,
    `PED-3E63D66E,2026-08-06,13:56,Arquímedes,+584244350860,"Clásico MED x1, Clásico IND x1, Cacao denso MED x1",Victor,entregado,31.5,23836.31,1.5,PASEO LAS DELICIAS 1`,
    `PED-3B65CBFE,2026-08-06,13:49,Angie Egidio,+584144691342,Cacao denso IND x1,Oscar,entregado,7.5,5675.31,1.5,`,
    `PED-C16F8123,2026-08-06,13:48,Daniela Castro,+584243647708,Clásico IND x1,Jose Angel,entregado,7.5,5675.31,1.5,`,
    `PED-222771A5,2026-08-06,13:28,Leonardo Mantilla,+584243038751,Clásico GRD x1,Pickup en tienda,entregado,24.0,18161.0,0,`,
    `PED-05F38219,2026-08-06,13:15,Yaditson,+584123698905,Clásico IND x1,Pickup en tienda,entregado,6.0,4540.25,0,`
  ];

  // Process rows
  let rowsToProcess: string[][] = [];

  const possibleCsvPaths = [
    path.join(process.cwd(), 'pedidos.csv'),
    path.join(process.cwd(), 'reporte.csv'),
    path.join(process.cwd(), 'prisma', 'pedidos.csv'),
    path.join(process.cwd(), 'prisma', 'reporte.csv'),
  ];

  let csvContent = '';
  for (const csvPath of possibleCsvPaths) {
    if (fs.existsSync(csvPath)) {
      console.log(`📂 Leyendo reporte CSV directamente desde archivo: ${csvPath}`);
      csvContent = fs.readFileSync(csvPath, 'utf-8');
      break;
    }
  }

  function parseCSVContent(text: string): string[][] {
    const rows: string[][] = [];
    let cur = '';
    let inQuotes = false;
    let row: string[] = [];

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const nextC = text[i + 1];

      if (c === '"') {
        if (inQuotes && nextC === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === ',' && !inQuotes) {
        row.push(cur.trim());
        cur = '';
      } else if ((c === '\r' || c === '\n') && !inQuotes) {
        if (c === '\r' && nextC === '\n') i++;
        row.push(cur.trim());
        cur = '';
        if (row.some(f => f.trim())) rows.push(row);
        row = [];
      } else {
        cur += c;
      }
    }
    if (cur || row.length > 0) {
      row.push(cur.trim());
      if (row.some(f => f.trim())) rows.push(row);
    }
    return rows;
  }

  if (csvContent) {
    rowsToProcess = parseCSVContent(csvContent);
  } else {
    // Fallback to rawData array
    for (const line of rawData) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      const fields: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) { fields.push(cur.trim()); cur = ''; }
        else cur += char;
      }
      fields.push(cur.trim());
      rowsToProcess.push(fields);
    }
  }

  const customersMap = new Map<string, { id: string; name: string; phone: string; gender: string; orderCount: number }>();
  const ambiguousNames: string[] = [];
  const ordersToInsert: any[] = [];
  const itemsToInsert: any[] = [];

  const driverUsers = await prisma.user.findMany({ where: { role: 'repartidor' } });

  let countCreated = 0;

  for (const fields of rowsToProcess) {
    const num = fields[0];
    if (!num || !num.startsWith('PED-')) continue;

    const [orderNum, dateStr, timeStr, custName, phone, itemsStr, driverName, status, totalUsdStr, totalVesStr, deliveryFeeStr, notes] = fields;

    const nameToUse = custName || 'Cliente General';
    const phoneToUse = phone || '';

    // Gender determination:
    let gender = 'M'; // default 'HOMBRE' / 'M'
    if (isFemaleName(nameToUse)) {
      gender = 'F';
    } else if (isMaleName(nameToUse)) {
      gender = 'M';
    } else if (nameToUse.includes('(Cotizacion') || nameToUse.toLowerCase().includes('vecinos')) {
      gender = 'M';
    } else {
      if (!ambiguousNames.includes(nameToUse)) {
        ambiguousNames.push(nameToUse);
      }
      gender = 'M';
    }

    // Customer
    let customerKey = `${nameToUse.toLowerCase()}_${phoneToUse.replace(/[^0-9]/g, '')}`;
    if (!customersMap.has(customerKey)) {
      customersMap.set(customerKey, {
        id: `c-${Math.random().toString(36).substring(2, 9)}`,
        name: nameToUse,
        phone: phoneToUse,
        gender: gender,
        orderCount: 0,
      });
    }
    const custObj = customersMap.get(customerKey)!;
    custObj.orderCount += 1;

    // Driver user lookup
    let deliveryId: string | null = null;
    let dName: string | null = null;
    if (driverName && driverName !== 'Pickup en tienda') {
      dName = driverName;
      const lower = driverName.toLowerCase().replace(/\s+/g, '');
      const matchedDriver = driverUsers.find(u => 
        lower.includes(u.username.toLowerCase()) || 
        u.name.toLowerCase().replace(/\s+/g, '').includes(lower) || 
        lower.includes(u.name.toLowerCase().replace(/\s+/g, ''))
      );
      if (matchedDriver) {
        deliveryId = matchedDriver.id;
        dName = matchedDriver.name;
      }
    }

    const isPickup = driverName === 'Pickup en tienda';
    const orderType = isPickup ? 'pickup' : 'delivery';
    const isQuote = status === 'cotizacion';
    const orderStatus = isQuote ? 'cotizacion' : 'entregado';

    const totalUsd = parseFloat(totalUsdStr || '0') || 0;
    const deliveryFee = parseFloat(deliveryFeeStr || '0') || 0;
    const itemsTotal = Math.max(0, totalUsd - deliveryFee);

    const createdAtDate = new Date(`${dateStr}T${timeStr || '12:00'}:00.000Z`);

    const orderId = `ord-${Math.random().toString(36).substring(2, 10)}`;

    ordersToInsert.push({
      id: orderId,
      order_number: orderNum,
      customer_name: nameToUse,
      customer_phone: phoneToUse,
      customer_gender: gender,
      order_type: orderType,
      delivery_address: notes || (isPickup ? 'Pickup en Tienda' : 'Ubicación registrada'),
      delivery_id: deliveryId,
      delivery_name: dName,
      delivery_fee: deliveryFee,
      status: orderStatus,
      is_quote: isQuote,
      total_usd: totalUsd,
      items_total: itemsTotal,
      notes: notes || null,
      created_at: createdAtDate,
      updated_at: createdAtDate,
    });

    if (itemsStr) {
      const itemParts = itemsStr.split(',').map(s => s.trim());
      for (const part of itemParts) {
        const match = part.match(/^(.*?)\s*x(\d+)$/i);
        if (match) {
          const flavorName = match[1].trim();
          const qty = parseInt(match[2], 10) || 1;
          itemsToInsert.push({
            order_id: orderId,
            flavor_id: 'f-clasico-01',
            flavor_name: flavorName,
            quantity: qty,
            price_usd: Math.round((itemsTotal / itemParts.length) * 100) / 100,
          });
        }
      }
    }

    countCreated++;
  }

  // Insert orders, items, and customers into Prisma in chunks
  const CHUNK_SIZE = 500;
  for (let i = 0; i < ordersToInsert.length; i += CHUNK_SIZE) {
    await prisma.order.createMany({ data: ordersToInsert.slice(i, i + CHUNK_SIZE) });
  }

  for (let i = 0; i < itemsToInsert.length; i += CHUNK_SIZE) {
    await prisma.orderItem.createMany({ data: itemsToInsert.slice(i, i + CHUNK_SIZE) });
  }

  const customersList = Array.from(customersMap.values()).map(c => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    gender: c.gender,
    order_count: c.orderCount,
  }));

  for (let i = 0; i < customersList.length; i += CHUNK_SIZE) {
    await prisma.customer.createMany({ data: customersList.slice(i, i + CHUNK_SIZE) });
  }

  console.log(`✅ ${countCreated} pedidos cargados exitosamente.`);
  console.log(`✅ ${customersMap.size} clientes registrados con su género.`);
  if (ambiguousNames.length > 0) {
    console.log('⚠️ Nombres con género asumido como Hombre (M) que podrías revisar:', ambiguousNames.join(', '));
  }
}
