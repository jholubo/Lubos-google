export function parseCoordsFromUrl(url: string): [number, number] | null {
  if (!url) return null;

  // Unwrap Facebook redirect
  if (url.includes('l.facebook.com') && url.includes('u=')) {
    try {
      const parsed = new URL(url);
      const inner = parsed.searchParams.get('u');
      if (inner) url = decodeURIComponent(inner);
    } catch {
      // ignore
    }
  }

  // Priority 1: !3d!4d = place data
  let m = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) {
    return [parseFloat(m[1]), parseFloat(m[2])];
  }

  // Priority 2: ?q=lat,lng or &q=lat,lng
  m = url.match(/[?&]q=(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/i);
  if (m) {
    return [parseFloat(m[1]), parseFloat(m[2])];
  }

  // Priority 3: @lat,lng = camera center
  m = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) {
    return [parseFloat(m[1]), parseFloat(m[2])];
  }

  return null;
}

export function pointInPolygon(lat: number, lng: number, polygon: number[][]): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [lat_i, lng_i] = polygon[i];
    const [lat_j, lng_j] = polygon[j];
    if (
      (lng_i > lng) !== (lng_j > lng) &&
      lat < ((lat_j - lat_i) * (lng - lng_i)) / ((lng_j - lng_i) || 1e-12) + lat_i
    ) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371.0;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dphi = toRad(lat2 - lat1);
  const dlmb = toRad(lng2 - lng1);

  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlmb / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export async function roadDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): Promise<[number, string]> {
  const apiKey = process.env.GOOGLE_MAPS_KEY;
  if (!apiKey) {
    return [haversineKm(lat1, lng1, lat2, lng2), 'haversine_fallback'];
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${lat1},${lng1}&destinations=${lat2},${lng2}&mode=driving&units=metric&key=${apiKey}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'OK' && data.rows?.[0]?.elements?.[0]?.status === 'OK') {
        const meters = data.rows[0].elements[0].distance.value;
        return [meters / 1000.0, 'google'];
      }
    }
  } catch (err) {
    console.warn('Distance Matrix API failed:', err);
  }
  return [haversineKm(lat1, lng1, lat2, lng2), 'haversine_fallback'];
}

export function calcDeliveryCost(distanceKm: number): number {
  if (distanceKm <= 3) {
    return 1.5;
  }
  return Math.round((1.5 + (distanceKm - 3) * 0.5) * 100) / 100;
}

export async function fetchDirectionsPolyline(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): Promise<string | null> {
  const apiKey = process.env.GOOGLE_MAPS_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${lat1},${lng1}&destination=${lat2},${lng2}&mode=driving&key=${apiKey}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.status === 'OK' && data.routes?.[0]?.overview_polyline?.points) {
        return data.routes[0].overview_polyline.points;
      }
    }
  } catch (err) {
    console.warn('Directions API failed:', err);
  }
  return null;
}
