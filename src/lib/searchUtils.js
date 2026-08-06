// Normaliza texto: minusculas + sin acentos/diacriticos (para buscar sin importar
// tildes, mayusculas o eñe). Ej: "Andrés Peña" -> "andres pena".
export function normalizeText(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Coincide si TODAS las palabras del query aparecen (como subcadena) en el texto,
// sin importar el orden, mayusculas, acentos o "n" vs "ñ".
// Ej: query "and pen" matches "Peña Andrea".
export function fuzzyMatch(text, query) {
  const q = normalizeText(query).trim();
  if (!q) return true;
  const t = normalizeText(text);
  const tokens = q.split(/\s+/).filter(Boolean);
  return tokens.every(tok => t.includes(tok));
}

// Filtro compatible con cmdk <Command filter={...}>: devuelve numero > 0 si coincide.
export function fuzzyCommandFilter(value, search) {
  const v = normalizeText(value);
  const q = normalizeText(search).trim();
  if (!q) return 1;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.every(tok => v.includes(tok))) return 0;
  if (v.startsWith(q)) return 1;
  if (v.includes(q)) return 0.8;
  return 0.5;
}
