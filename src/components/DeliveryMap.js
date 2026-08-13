import { useState, useMemo, useCallback, useEffect, useRef, memo } from 'react';
import { GoogleMap, Marker, OverlayViewF, Polyline } from '@react-google-maps/api';
import { SafeMapsLoader, DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLES } from '@/lib/mapsLoader';
import { Loader2, Maximize2, MapPin, Home, Crosshair, Frame, Package } from 'lucide-react';

const STATUS_COLOR = {
  pendiente: '#C27A29',  // amber
  en_camino: '#4285F4',  // blue
};

// Deterministic hue per delivery id. Same delivery → same color, always.
function deliveryColor(id) {
  const s = String(id || 'x');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 78%, 44%)`;
}

// Order pin color helper: when status is "en_camino" and assigned to driver, use driver's distinct color
function getOrderPinColor(o, deliveryLocations = []) {
  if (o.wait_for_notice) return '#808080';

  if (o.status === 'en_camino') {
    if (o.delivery_id) {
      const driver = (deliveryLocations || []).find(dl => String(dl.delivery_id) === String(o.delivery_id));
      if (driver?.color) return driver.color;
      return deliveryColor(o.delivery_id);
    }
    return STATUS_COLOR.en_camino;
  }

  return STATUS_COLOR[o.status] || '#501122';
}

// Distance calculation in meters between two lat/lng pairs
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Pin SVG path
const buildPinIcon = (color, opacity = 1) => ({
  path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z',
  fillColor: color,
  fillOpacity: opacity,
  strokeColor: '#fff',
  strokeWeight: 1.5,
  scale: 1.6,
  anchor: { x: 12, y: 22 },
});

// Memoized custom Overlay component for live delivery drivers to prevent flickering on position changes
const LiveDriverOverlay = memo(({ d, position, pixelOffsetX, pixelOffsetY, color, isInactive }) => {
  const posLat = position?.lat;
  const posLng = position?.lng;
  const stablePosition = useMemo(() => ({ lat: posLat, lng: posLng }), [posLat, posLng]);

  const getOffset = useCallback((w, h) => ({
    x: -(w / 2) + pixelOffsetX,
    y: -(h / 2) + pixelOffsetY,
  }), [pixelOffsetX, pixelOffsetY]);

  return (
    <OverlayViewF
      position={stablePosition}
      mapPaneName="overlayMouseTarget"
      getPixelPositionOffset={getOffset}
    >
      <div
        className={`pointer-events-none flex flex-col items-center transition-opacity duration-300 ${isInactive ? 'opacity-80' : ''}`}
        data-testid={`delivery-live-${d.delivery_id}`}
        title={`${d.name} - ${isInactive ? 'Sin señal' : 'En ruta'}`}
      >
        <div className="relative">
          <div
            className={`relative w-9 h-9 rounded-full overflow-hidden border-[3px] shadow-lg bg-white flex items-center justify-center transition-transform hover:scale-110 ${!isInactive ? 'animate-driver-pulse' : 'grayscale'}`}
            style={{ borderColor: color, '--pulse-color': color }}
          >
            {d.photo_url ? (
              <img src={d.photo_url} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <span className="text-[11px] font-bold text-[#501122]">{(d.name || '?')[0]}</span>
            )}
          </div>
        </div>
        <span className="mt-0.5 px-1.5 py-0 rounded-full text-white text-[9px] font-bold uppercase tracking-wider shadow-md whitespace-nowrap" style={{ background: color }}>
          {d.name || 'Delivery'}{isInactive ? ' (Sin señal)' : ''}
        </span>
      </div>
    </OverlayViewF>
  );
});

export function MapBody({ orders, height, centralPoint, centerRequestId = 0, defaultZoom = DEFAULT_ZOOM, hideCentralPin = false, draggablePinId = null, onPinDragEnd = null, showRoute = false, onRouteStatus = null, fitAllRequestId = 0, deliveryLocations = [], userPanned, setUserPanned }) {
  const [localUserPanned, setLocalUserPanned] = useState(false);
  const isPanned = userPanned !== undefined ? userPanned : localUserPanned;
  const setPanned = setUserPanned !== undefined ? setUserPanned : setLocalUserPanned;

  const [mapInstance, setMapInstance] = useState(null);
  const [zoom, setZoom] = useState(defaultZoom);
  const [routePath, setRoutePath] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const hasCentral = centralPoint && typeof centralPoint.lat === 'number' && typeof centralPoint.lng === 'number';

  const getCentralOffset = useCallback((w, h) => ({ x: -(w / 2), y: -(h / 2) }), []);
  const getLabelOffset = useCallback((w, h) => ({ x: -(w / 2), y: -(h + 38) }), []);

  const onZoomChanged = useCallback(() => {
    if (mapInstance) {
      const z = mapInstance.getZoom();
      if (typeof z === 'number') setZoom(z);
    }
  }, [mapInstance]);

  // Set initial center once on load; do NOT keep the map centered on subsequent renders
  const handleLoad = useCallback((m) => {
    const initial = hasCentral ? { lat: centralPoint.lat, lng: centralPoint.lng } : DEFAULT_CENTER;
    m.setCenter(initial);
    m.setZoom(defaultZoom);
    setMapInstance(m);
  }, [hasCentral, centralPoint, defaultZoom]);

  // Explicit re-center only when parent bumps centerRequestId
  // (Skip this when we are showing a route — fitBounds handles framing there.)
  useEffect(() => {
    if (!mapInstance || centerRequestId <= 0 || !hasCentral || showRoute) return;
    mapInstance.panTo({ lat: centralPoint.lat, lng: centralPoint.lng });
    mapInstance.setZoom(defaultZoom);
  }, [centerRequestId, mapInstance, hasCentral, centralPoint, defaultZoom, showRoute]);

  // Per-order schedule info (used for label badge under the customer name)
  const orderPoints = useMemo(() => {
    return orders
      .filter(o => typeof o.lat === 'number' && typeof o.lng === 'number')
      .map(o => {
        let scheduleLabel = null;
        if (o.scheduled_for) {
          try {
            const d = new Date(o.scheduled_for);
            scheduleLabel = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: true }).replace(/^0/, '');
          } catch (_) { /* ignore */ }
        }
        return { ...o, scheduleLabel };
      });
  }, [orders]);

  // Stack labels for nearby orders (visual clustering by rounded coords + zoom)
  const labelGroups = useMemo(() => {
    const precision = zoom >= 16 ? 4 : zoom >= 14 ? 3 : 2;
    const map = new Map();
    for (const o of orderPoints) {
      const key = `${o.lat.toFixed(precision)}|${o.lng.toFixed(precision)}`;
      if (!map.has(key)) map.set(key, { lat: o.lat, lng: o.lng, items: [] });
      map.get(key).items.push(o);
    }
    return Array.from(map.values());
  }, [orderPoints, zoom]);

  // Calculate route between central point and order pin when showRoute is enabled
  const routeDestLat = showRoute && orderPoints.length === 1 ? orderPoints[0].lat : null;
  const routeDestLng = showRoute && orderPoints.length === 1 ? orderPoints[0].lng : null;
  const cpLat = hasCentral ? centralPoint.lat : null;
  const cpLng = hasCentral ? centralPoint.lng : null;
  const onRouteStatusRef = useRef(onRouteStatus);
  useEffect(() => { onRouteStatusRef.current = onRouteStatus; }, [onRouteStatus]);

  useEffect(() => {
    if (!mapInstance || !showRoute || routeDestLat == null || cpLat == null) {
      setRoutePath(null);
      if (onRouteStatusRef.current) onRouteStatusRef.current(null);
      return;
    }

    const origin = { lat: cpLat, lng: cpLng };
    const destination = { lat: routeDestLat, lng: routeDestLng };
    const straightPath = [origin, destination];

    let cancelled = false;

    if (window.google?.maps?.DirectionsService) {
      const directionsService = new window.google.maps.DirectionsService();
      directionsService.route(
        {
          origin,
          destination,
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (cancelled) return;
          if (status === window.google.maps.DirectionsStatus.OK && result?.routes?.[0]?.overview_path) {
            const overviewPath = result.routes[0].overview_path.map(pt => ({ lat: pt.lat(), lng: pt.lng() }));
            setRoutePath(overviewPath);
            if (onRouteStatusRef.current) onRouteStatusRef.current('route');
            try {
              const bounds = new window.google.maps.LatLngBounds();
              overviewPath.forEach(p => bounds.extend(p));
              mapInstance.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
            } catch { /* ignore */ }
          } else {
            setRoutePath(straightPath);
            if (onRouteStatusRef.current) onRouteStatusRef.current('fallback');
            try {
              const bounds = new window.google.maps.LatLngBounds();
              straightPath.forEach(p => bounds.extend(p));
              mapInstance.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
            } catch { /* ignore */ }
          }
        }
      );
    } else {
      setRoutePath(straightPath);
      if (onRouteStatusRef.current) onRouteStatusRef.current('fallback');
      try {
        const bounds = new window.google.maps.LatLngBounds();
        straightPath.forEach(p => bounds.extend(p));
        mapInstance.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
      } catch { /* ignore */ }
    }

    return () => { cancelled = true; };
  }, [mapInstance, showRoute, routeDestLat, routeDestLng, cpLat, cpLng]);

  // "Encuadrar" (fit-all) — bumped by parent to reframe the map to include every
  // order pin plus the store and live delivery driver locations. No-op when called with 0 (initial mount).
  const lastFitAllIdRef = useRef(fitAllRequestId);
  useEffect(() => {
    if (!mapInstance || !window.google?.maps) return;

    const isManualClick = fitAllRequestId > 0 && fitAllRequestId !== lastFitAllIdRef.current;
    if (isManualClick) {
      setPanned(false);
      lastFitAllIdRef.current = fitAllRequestId;
    } else {
      if (fitAllRequestId <= 0) return;
      if (isPanned) return;
    }

    const pts = [];
    if (hasCentral) pts.push({ lat: centralPoint.lat, lng: centralPoint.lng });
    orderPoints.forEach(o => pts.push({ lat: o.lat, lng: o.lng }));
    (deliveryLocations || []).forEach(d => {
      if (typeof d.lat === 'number' && typeof d.lng === 'number') {
        pts.push({ lat: d.lat, lng: d.lng });
      }
    });
    if (pts.length === 0) return;
    if (pts.length === 1) {
      mapInstance.panTo(pts[0]);
      mapInstance.setZoom(15);
      return;
    }
    try {
      const bounds = new window.google.maps.LatLngBounds();
      pts.forEach(p => bounds.extend(p));
      mapInstance.fitBounds(bounds, 80);
    } catch { /* ignore */ }
  }, [fitAllRequestId, isPanned, setPanned, mapInstance, hasCentral, centralPoint, orderPoints, deliveryLocations]);

  // Filter active live delivery drivers (seen in last 5 minutes)
  const activeDrivers = useMemo(() => {
    return (deliveryLocations || []).filter(d => {
      if (typeof d.lat !== 'number' || typeof d.lng !== 'number') return false;
      if (d.updated_at) {
        const updatedMs = new Date(d.updated_at).getTime();
        const fiveMinutesAgo = now - 5 * 60 * 1000;
        if (updatedMs < fiveMinutesAgo) return false;
      }
      return true;
    });
  }, [deliveryLocations, now]);

  // Separate active drivers into: drivers at store vs drivers on the road
  const { driversAtStore, roadDriverMarkers } = useMemo(() => {
    if (!activeDrivers.length) return { driversAtStore: [], roadDriverMarkers: [] };

    const storeLat = (hasCentral && centralPoint) ? centralPoint.lat : null;
    const storeLng = (hasCentral && centralPoint) ? centralPoint.lng : null;

    const storeDrivers = [];
    const roadDrivers = [];

    for (const d of activeDrivers) {
      if (storeLat != null && storeLng != null) {
        const distToStore = getDistanceMeters(d.lat, d.lng, storeLat, storeLng);
        if (distToStore < 80) { // < 80 meters from store
          storeDrivers.push(d);
          continue;
        }
      }
      roadDrivers.push(d);
    }

    // Group drivers on the road if they are very close (< 30m) to avoid exact overlap
    const clusters = [];
    for (const d of roadDrivers) {
      let added = false;
      for (const c of clusters) {
        const ref = c[0];
        if (getDistanceMeters(d.lat, d.lng, ref.lat, ref.lng) < 30) {
          c.push(d);
          added = true;
          break;
        }
      }
      if (!added) clusters.push([d]);
    }

    const markers = [];
    for (const c of clusters) {
      const count = c.length;
      if (count === 1) {
        const d = c[0];
        markers.push({
          driver: d,
          position: { lat: d.lat, lng: d.lng },
          pixelOffsetX: 0,
          pixelOffsetY: 0,
        });
      } else {
        const avgLat = c.reduce((sum, item) => sum + item.lat, 0) / count;
        const avgLng = c.reduce((sum, item) => sum + item.lng, 0) / count;
        const radius = Math.max(26, 16 + count * 4);

        c.forEach((d, i) => {
          const angle = (-Math.PI / 2) + (i * (2 * Math.PI / count));
          const offsetX = Math.round(radius * Math.cos(angle));
          const offsetY = Math.round(radius * Math.sin(angle));

          markers.push({
            driver: d,
            position: { lat: avgLat, lng: avgLng },
            pixelOffsetX: offsetX,
            pixelOffsetY: offsetY,
          });
        });
      }
    }

    return { driversAtStore: storeDrivers, roadDriverMarkers: markers };
  }, [activeDrivers, hasCentral, centralPoint]);

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height }}
      zoom={defaultZoom}
      onLoad={handleLoad}
      onZoomChanged={onZoomChanged}
      onDragStart={() => setPanned(true)}
      options={{
        styles: MAP_STYLES,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      }}
    >
      {routePath && (
        <>
          <Polyline
            path={routePath}
            options={{
              strokeColor: '#2B0912',
              strokeOpacity: 0.35,
              strokeWeight: 6,
              geodesic: true,
              clickable: false,
            }}
          />
          <Polyline
            path={routePath}
            options={{
              strokeColor: '#501122',
              strokeOpacity: 0.95,
              strokeWeight: 4,
              geodesic: true,
              clickable: false,
            }}
          />
        </>
      )}
      {hasCentral && !hideCentralPin && (
        <OverlayViewF
          position={{ lat: centralPoint.lat, lng: centralPoint.lng }}
          mapPaneName="overlayMouseTarget"
          getPixelPositionOffset={getCentralOffset}
        >
          <div className="flex flex-col items-center pointer-events-none" data-testid="map-central-point">
            {/* Repartidores actualmente en la tienda: se ven como un grupo compacto de puntos con sus colores */}
            {driversAtStore.length > 0 && (
              <div
                className="mb-1 pointer-events-auto flex items-center gap-1.5 bg-[#1F1517]/90 backdrop-blur-xs border border-white/20 px-2 py-0.5 rounded-full shadow-lg"
                title={`Repartidores en tienda: ${driversAtStore.map(d => d.name || 'Delivery').join(', ')}`}
              >
                <div className="flex items-center -space-x-1">
                  {driversAtStore.map((d) => {
                    const isInactive = d.updated_at ? (now - new Date(d.updated_at).getTime() > 1 * 60 * 1000) : false;
                    const color = isInactive ? '#9CA3AF' : (d.color || deliveryColor(d.delivery_id));
                    return (
                      <span
                        key={`store-dot-${d.delivery_id}`}
                        className={`block w-3.5 h-3.5 rounded-full border-2 border-white shadow-xs transition-transform hover:scale-125 ${isInactive ? 'opacity-70 grayscale' : ''}`}
                        style={{ backgroundColor: color }}
                        title={`${d.name || 'Delivery'} ${isInactive ? '(Sin señal)' : '(En tienda)'}`}
                      />
                    );
                  })}
                </div>
                <span className="text-[9px] font-extrabold text-amber-300 uppercase tracking-wider whitespace-nowrap">
                  {driversAtStore.length} en tienda
                </span>
              </div>
            )}

            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-[#501122]/25 animate-ping"></div>
              <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-[#7A1A33] to-[#501122] border-2 border-white shadow-[0_3px_10px_rgba(80,17,34,0.4)] flex items-center justify-center">
                <Home className="h-3.5 w-3.5 text-white" strokeWidth={2.4} fill="white" />
              </div>
            </div>
            <span className="mt-0.5 px-1.5 py-0 rounded-full bg-[#501122] text-white text-[8px] font-bold uppercase tracking-wider shadow-md whitespace-nowrap">
              Tienda
            </span>
          </div>
        </OverlayViewF>
      )}

      {orderPoints.map(o => {
        const isWaitNotice = !!o.wait_for_notice;
        const color = getOrderPinColor(o, deliveryLocations);
        const opacity = isWaitNotice ? 0.6 : 1;
        const icon = window.google ? buildPinIcon(color, opacity) : null;
        const isDraggable = draggablePinId && o.id === draggablePinId;
        return (
          <Marker
            key={o.id}
            position={{ lat: o.lat, lng: o.lng }}
            icon={icon}
            draggable={isDraggable}
            onDragEnd={isDraggable && onPinDragEnd ? (e) => {
              onPinDragEnd(o.id, e.latLng.lat(), e.latLng.lng());
            } : undefined}
            title={`${o.customer_name} - ${o.order_number}${isWaitNotice ? ' - Esperar aviso' : o.scheduleLabel ? ' - ' + o.scheduleLabel : ''}${isDraggable ? ' (arrastra para ajustar)' : ''}`}
          />
        );
      })}

      {labelGroups.map((g, gi) => (
        <OverlayViewF
          key={`g-${gi}`}
          position={{ lat: g.lat, lng: g.lng }}
          mapPaneName="overlayMouseTarget"
          getPixelPositionOffset={getLabelOffset}
        >
          <div className="flex flex-col gap-0.5 items-center pointer-events-none">
            {g.items.map(o => {
              const isWaitNotice = !!o.wait_for_notice;
              const color = getOrderPinColor(o, deliveryLocations);
              return (
                <div
                  key={o.id}
                  className={`rounded-xl bg-[#1F1517]/95 text-white whitespace-nowrap shadow-md border px-2 py-0.5 flex flex-col items-center leading-tight ${isWaitNotice ? 'opacity-70 grayscale border-gray-400' : ''}`}
                  style={{ borderColor: color }}
                  title={o.order_number}
                >
                  <span className="text-[10px] font-semibold">{o.customer_name}</span>
                  {isWaitNotice ? (
                    <span className="text-[9px] font-bold text-gray-300 uppercase tracking-wider">esperar aviso</span>
                  ) : o.scheduleLabel ? (
                    <span className="text-[9px] font-bold text-[#FFD68A]">{o.scheduleLabel}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </OverlayViewF>
      ))}

      {/* Ubicacion en vivo de los repartidores en ruta */}
      {roadDriverMarkers.map(({ driver: d, position, pixelOffsetX, pixelOffsetY }) => {
        const isInactive = d.updated_at ? (now - new Date(d.updated_at).getTime() > 1 * 60 * 1000) : false;
        const color = isInactive ? '#9CA3AF' : (d.color || deliveryColor(d.delivery_id));
        return (
          <LiveDriverOverlay
            key={`dloc-${d.delivery_id}`}
            d={d}
            position={position}
            pixelOffsetX={pixelOffsetX}
            pixelOffsetY={pixelOffsetY}
            color={color}
            isInactive={isInactive}
          />
        );
      })}
    </GoogleMap>
  );
}

export function isScheduledForFutureDay(scheduledForStr) {
  if (!scheduledForStr) return false;
  try {
    const nowVE = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const sched = new Date(scheduledForStr);
    const schedVE = new Date(sched.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const todayStart = new Date(nowVE.getFullYear(), nowVE.getMonth(), nowVE.getDate()).getTime();
    const schedStart = new Date(schedVE.getFullYear(), schedVE.getMonth(), schedVE.getDate()).getTime();
    return schedStart > todayStart;
  } catch (_) {
    return false;
  }
}

function DeliveryMapInner({ isLoaded, loadError, orders, title = 'Mapa de Entregas', subtitle, testId = 'delivery-map', hideFutureDays = true, centralPoint = null, expandHref = null, defaultHeight = 320, minimal = false, deliveryLocations = [], showRoute = false }) {
  const [centerRequestId, setCenterRequestId] = useState(0);
  const [fitAllRequestId, setFitAllRequestId] = useState(0);
  const [userPanned, setUserPanned] = useState(false);

  // Filter out orders scheduled for a future day so they only appear starting on their scheduled date.
  const visibleOrders = useMemo(() => {
    if (!hideFutureDays) return orders || [];
    return (orders || []).filter(o => !isScheduledForFutureDay(o.scheduled_for));
  }, [orders, hideFutureDays]);

  const validCount = useMemo(
    () => visibleOrders.filter(o => typeof o.lat === 'number' && typeof o.lng === 'number').length,
    [visibleOrders]
  );

  const activeDeliveriesCount = useMemo(
    () => (deliveryLocations || []).filter(d => typeof d.lat === 'number' && typeof d.lng === 'number').length,
    [deliveryLocations]
  );

  const hasCentral = centralPoint && typeof centralPoint.lat === 'number' && typeof centralPoint.lng === 'number';
  const showMap = validCount > 0 || activeDeliveriesCount > 0 || hasCentral;

  // JS-based resizable wrapper (CSS `resize` is not supported on divs in Safari).
  // Users can drag the bottom edge/handle to grow the map up to viewport height.
  const wrapperRef = useRef(null);
  const [mapHeight, setMapHeight] = useState(defaultHeight);
  const draggingRef = useRef(null); // { startY, startH }

  const onDragStart = useCallback((clientY) => {
    draggingRef.current = { startY: clientY, startH: mapHeight };
  }, [mapHeight]);

  const onDragMove = useCallback((clientY) => {
    const d = draggingRef.current;
    if (!d) return;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    const minH = 240;
    const maxH = Math.max(minH + 60, vh - 40);
    const next = Math.min(maxH, Math.max(minH, d.startH + (clientY - d.startY)));
    setMapHeight(next);
  }, []);

  const onDragEnd = useCallback(() => { draggingRef.current = null; }, []);

  useEffect(() => {
    const onMouseMove = (e) => onDragMove(e.clientY);
    const onTouchMove = (e) => {
      if (!draggingRef.current) return;
      if (e.touches && e.touches[0]) onDragMove(e.touches[0].clientY);
      // Prevent page scroll while resizing on touch devices
      if (e.cancelable) e.preventDefault();
    };
    const stop = () => onDragEnd();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', stop);
    window.addEventListener('touchcancel', stop);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', stop);
      window.removeEventListener('touchcancel', stop);
    };
  }, [onDragMove, onDragEnd]);

  return (
    <div className={`bg-white rounded-[1.5rem] border border-[#501122]/10 shadow-[0_8px_30px_rgba(80,17,34,0.03)] overflow-hidden ${minimal ? 'h-full flex flex-col' : ''}`} data-testid={testId}>
      <div className={minimal ? 'flex-1 min-h-0 relative' : 'relative'}>
        {loadError && (
          <p className="text-center py-10 text-[#78686C] text-sm">
            {loadError.message === 'GOOGLE_MAPS_KEY_MISSING'
              ? 'Google Maps no configurado (falta GOOGLE_MAPS_KEY)'
              : 'Error cargando Google Maps'}
          </p>
        )}
        {!isLoaded && !loadError && (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-[#501122]" /></div>
        )}
        {isLoaded && !showMap && (
          <p className="text-center py-10 text-[#78686C] text-sm">No hay pedidos con ubicacion para mostrar</p>
        )}
        {isLoaded && showMap && (
          <div
            ref={wrapperRef}
            className={minimal ? 'w-full h-full relative' : 'min-h-[240px] relative'}
            style={{ height: minimal ? '100%' : `${mapHeight}px`, touchAction: draggingRef.current ? 'none' : undefined }}
            data-testid={`${testId}-resizable`}
          >
            {/* Top Center Floating Queue Badge */}
            <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/95 backdrop-blur-md border border-[#501122]/15 shadow-md text-xs font-bold text-[#501122] select-none">
              <Package className="h-4 w-4 text-[#C27A29]" />
              <span>{validCount} {validCount === 1 ? 'pedido en cola' : 'pedidos en cola'}</span>
            </div>

            <div className="w-full h-full">
              <MapBody orders={visibleOrders} height="100%" centralPoint={centralPoint} centerRequestId={centerRequestId} fitAllRequestId={fitAllRequestId} deliveryLocations={deliveryLocations} showRoute={showRoute} userPanned={userPanned} setUserPanned={setUserPanned} />
            </div>

            {/* Bottom Center Floating Encuadrar Button */}
            <button
              type="button"
              onClick={() => {
                setFitAllRequestId(id => id + 1);
                setUserPanned(false);
              }}
              data-testid={`${testId}-fit-all-btn`}
              title="Encuadrar la tienda, pedidos por entregar y repartidores"
              className="absolute left-1/2 -translate-x-1/2 bottom-5 z-10 flex items-center gap-2 px-5 h-10 rounded-full bg-[#501122] hover:bg-[#3D0C19] text-white text-xs font-bold uppercase tracking-wider shadow-lg active:scale-95 transition-all"
            >
              <Frame className="h-4 w-4" />
              <span>Encuadrar</span>
            </button>

            {!minimal && (
              <>
                <div
                  className="absolute left-0 right-0 bottom-0 h-5 flex items-center justify-center cursor-ns-resize select-none group z-10"
                  style={{ touchAction: 'none', background: 'linear-gradient(to top, rgba(80,17,34,0.06), transparent)' }}
                  onMouseDown={(e) => { e.preventDefault(); onDragStart(e.clientY); }}
                  onTouchStart={(e) => { if (e.touches && e.touches[0]) onDragStart(e.touches[0].clientY); }}
                  onDoubleClick={() => setMapHeight(defaultHeight)}
                  data-testid={`${testId}-resize-handle`}
                  title="Arrastra para ampliar el mapa"
                >
                  <div className="h-1.5 w-14 rounded-full bg-[#501122]/25 group-hover:bg-[#501122]/50 transition-colors"></div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DeliveryMap(props) {
  return (
    <SafeMapsLoader>
      {({ isLoaded, loadError }) => (
        <DeliveryMapInner isLoaded={isLoaded} loadError={loadError} {...props} />
      )}
    </SafeMapsLoader>
  );
}
