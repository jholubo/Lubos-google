// Client-side cache for instant app responsiveness & offline/internal storage
const memoryCache = new Map();

export const getLocalCache = (key, defaultValue = null) => {
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }
  try {
    const raw = localStorage.getItem(`lubos_cache_${key}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      memoryCache.set(key, parsed);
      return parsed;
    }
  } catch (e) {
    console.warn('[Cache] read error for key:', key, e);
  }
  return defaultValue;
};

export const setLocalCache = (key, value) => {
  memoryCache.set(key, value);
  try {
    localStorage.setItem(`lubos_cache_${key}`, JSON.stringify(value));
  } catch (e) {
    console.warn('[Cache] write error for key:', key, e);
  }
};

export const removeLocalCache = (key) => {
  memoryCache.delete(key);
  try {
    localStorage.removeItem(`lubos_cache_${key}`);
  } catch (e) {
    // ignore
  }
};

export const clearAllCache = () => {
  memoryCache.clear();
  try {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('lubos_cache_')) {
        localStorage.removeItem(k);
      }
    });
  } catch (e) {
    // ignore
  }
};
