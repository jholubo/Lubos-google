import { getLocalCache, setLocalCache } from './cache';
import api from './api';

export function getStoredCentralPoint() {
  if (typeof window === 'undefined') return null;

  // Check store_central_point cache first
  const cached = getLocalCache('store_central_point');
  if (cached && typeof cached.lat === 'number' && typeof cached.lng === 'number') {
    return { lat: cached.lat, lng: cached.lng, url: cached.url || '' };
  }

  // Fallback to settings cache
  const settings = getLocalCache('settings');
  if (settings && typeof settings.central_point_lat === 'number' && typeof settings.central_point_lng === 'number') {
    return {
      lat: settings.central_point_lat,
      lng: settings.central_point_lng,
      url: settings.central_point_url || '',
    };
  }

  return null;
}

export async function saveCentralPointCoords(lat, lng, url = '') {
  if (typeof lat !== 'number' || typeof lng !== 'number') return;

  const point = {
    lat,
    lng,
    url: url || `https://maps.google.com/?q=${lat},${lng}`,
  };

  // 1. Save in local cache immediately
  setLocalCache('store_central_point', point);

  const existingSettings = getLocalCache('settings') || {};
  const updatedSettings = {
    ...existingSettings,
    central_point_lat: lat,
    central_point_lng: lng,
    central_point_url: point.url,
  };
  setLocalCache('settings', updatedSettings);

  // 2. Dispatch event so UI updates instantly across all open tabs/views
  window.dispatchEvent(new CustomEvent('lubos:settings-changed', { detail: updatedSettings }));

  // 3. Save to backend permanently
  try {
    const payload = url
      ? { central_point_url: url }
      : { central_point_lat: lat, central_point_lng: lng };
    await api.put('/settings', payload);
  } catch (err) {
    console.warn('[centralPoint] Error syncing central point to backend:', err?.message || err);
  }
}

export async function syncCentralPointWithBackend(sData) {
  if (!sData) return;

  const localCp = getStoredCentralPoint();

  if (typeof sData.central_point_lat === 'number' && typeof sData.central_point_lng === 'number') {
    // Backend has central point -> sync to localStorage
    const point = {
      lat: sData.central_point_lat,
      lng: sData.central_point_lng,
      url: sData.central_point_url || '',
    };
    setLocalCache('store_central_point', point);
  } else if (localCp) {
    // Backend does not have central point, but localStorage DOES -> push to backend automatically!
    try {
      const payload = localCp.url
        ? { central_point_url: localCp.url }
        : { central_point_lat: localCp.lat, central_point_lng: localCp.lng };
      await api.put('/settings', payload);
    } catch { /* ignore silently */ }
  }
}
