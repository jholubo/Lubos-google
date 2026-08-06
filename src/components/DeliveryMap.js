import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { GoogleMap, Marker, OverlayView, Polyline } from '@react-google-maps/api';
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

export function MapBody({ orders, height, centralPoint, centerRequestId = 0, defaultZoom = DEFAULT_ZOOM, hideCentralPin = false, draggablePinId = null, onPinDragEnd = null, showRoute = false, onRouteStatus = null, fitAllRequestId = 0, deliveryLocations = [] }) {
  const [mapInstance, setMapInstance] = useState(null);
  const [zoom, setZoom] = useState(defaultZoom);
  const [routePath, setRoutePath] = useState(null);

  const hasCentral = centralPoint && typeof centralPoint.lat === 'number' && typeof centralPoint.lng === 'number';

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

  // Compute Google-driving route from central point to the (single) order pin.
  // Falls back to a straight geodesic line if Directions API is unavailable
  // (project may only have Distance Matrix enabled — the fallback still lets
  // the user see the store<->pin span and drag the pin to correct it).
  const routeDestLat = showRoute && orderPoints.length === 1 ? orderPoints[0].lat : null;
  const routeDestLng = showRoute && orderPoints.length === 1 ? orderPoints[0].lng : null;
  const cpLat = hasCentral ? centralPoint.lat : null;
  const cpLng = hasCentral ? centralPoint.lng : null;
  const [routeIsFallback, setRouteIsFallback] = useState(false);
  const onRouteStatusRef = useRef(onRouteStatus);
  useEffect(() => { onRouteStatusRef.current = onRouteStatus; }, [onRouteStatus]);
  useEffect(() => {
    if (!mapInstance || !showRoute || routeDestLat == null || cpLat == null) {
      setRoutePath(null);
      setRouteIsFallback(false);
      if (onRouteStatusRef.current) onRouteStatusRef.current(null);
      return;
    }
    if (!window.google?.maps) return;

    const applyBounds = (pathPoints) => {
      try {
        const bounds = new window.google.maps.LatLngBounds();
        pathPoints.forEach(p => bounds.extend(p));
        mapInstance.fitBounds(bounds, 60);
      } catch { /* ignore */ }
    };

    const straightFallback = () => {
      const path = [
        { lat: cpLat, lng: cpLng },
        { lat: routeDestLat, lng: routeDestLng },
      ];
      setRoutePath(path);
      setRouteIsFallback(true);
      if (onRouteStatusRef.current) onRouteStatusRef.current('fallback');
      applyBounds(path);
    };

    if (!window.google.maps.DirectionsService) {
      straightFallback();
      return;
    }
    const svc = new window.google.maps.DirectionsService();
    let cancelled = false;
    svc.route(
      {
        origin: { lat: cpLat, lng: cpLng },
        destination: { lat: routeDestLat, lng: routeDestLng },
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (cancelled) return;
        if (status === 'OK' && result?.routes?.[0]?.overview_path) {
          const path = result.routes[0].overview_path.map(p => ({ lat: p.lat(), lng: p.lng() }));
          setRoutePath(path);
          setRouteIsFallback(false);
          if (onRouteStatusRef.current) onRouteStatusRef.current('route');
          applyBounds([...path, { lat: cpLat, lng: cpLng }, { lat: routeDestLat, lng: routeDestLng }]);
        } else {
          straightFallback();
        }
      }
    );
    return () => { cancelled = true; };
  }, [mapInstance, showRoute, routeDestLat, routeDestLng, cpLat, cpLng]);

  // "Encuadrar" (fit-all) — bumped by parent to reframe the map to include every
  // order pin plus the store. No-op when called with 0 (initial mount).
  useEffect(() => {
    if (!mapInstance || fitAllRequestId <= 0 || !window.google?.maps) return;
    const pts = [];
    if (hasCentral) pts.push({ lat: centralPoint.lat, lng: centralPoint.lng });
    orderPoints.forEach(o => pts.push({ lat: o.lat, lng: o.lng }));
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
  }, [fitAllRequestId, mapInstance, hasCentral, centralPoint, orderPoints]);

  return (
    <GoogleMap
      mapContainerStyle={{ width: '100%', height }}
      zoom={defaultZoom}
      onLoad={handleLoad}
      onZoomChanged={onZoomChanged}
      options={{
        styles: MAP_STYLES,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      }}
    >
      {routePath && (
        <Polyline
          path={routePath}
          options={routeIsFallback ? {
            // Straight-line fallback (Directions API not available): dashed, muted
            strokeOpacity: 0,
            geodesic: true,
            icons: [{
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: '#78686C', scale: 3 },
              offset: '0',
              repeat: '12px',
            }],
          } : {
            strokeColor: '#501122',
            strokeOpacity: 0.9,
            strokeWeight: 5,
            geodesic: true,
          }}
        />
      )}
      {hasCentral && !hideCentralPin && (
        <OverlayView
          position={{ lat: centralPoint.lat, lng: centralPoint.lng }}
          mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          getPixelPositionOffset={(w, h) => ({ x: -(w / 2), y: -(h / 2) })}
        >
          <div className="flex flex-col items-center pointer-events-none" data-testid="map-central-point">
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
        </OverlayView>
      )}

      {orderPoints.map(o => {
        const isWaitNotice = !!o.wait_for_notice;
        const color = isWaitNotice ? '#808080' : (STATUS_COLOR[o.status] || '#501122');
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
        <OverlayView
          key={`g-${gi}`}
          position={{ lat: g.lat, lng: g.lng }}
          mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          getPixelPositionOffset={(w, h) => ({ x: -(w / 2), y: -(h + 38) })}
        >
          <div className="flex flex-col gap-0.5 items-center pointer-events-none">
            {g.items.map(o => {
              const isWaitNotice = !!o.wait_for_notice;
              const color = isWaitNotice ? '#6B7280' : (STATUS_COLOR[o.status] || '#501122');
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
        </OverlayView>
      ))}

      {/* Rutas dinamicas por delivery: se dibujan cuando el pedido tiene
          route_polyline (guardado una sola vez cuando el delivery marca "en_camino").
          Se muestran solo mientras el pedido no este entregado. Color por delivery. */}
      {window.google?.maps?.geometry && (orders || [])
        .filter(o => o.status === 'en_camino' && o.route_polyline && o.delivery_id)
        .map(o => {
          let path = null;
          try { path = window.google.maps.geometry.encoding.decodePath(o.route_polyline).map(p => ({ lat: p.lat(), lng: p.lng() })); }
          catch { return null; }
          if (!path || path.length < 2) return null;
          return (
            <Polyline
              key={`route-${o.id}`}
              path={path}
              options={{
                strokeColor: deliveryColor(o.delivery_id),
                strokeOpacity: 0.9,
                strokeWeight: 5,
                geodesic: true,
                clickable: false,
              }}
            />
          );
        })}

      {/* Ubicacion en vivo del delivery: pin con foto/inicial y ring de su color. */}
      {(deliveryLocations || []).filter(d => typeof d.lat === 'number' && typeof d.lng === 'number').map(d => {
        const color = deliveryColor(d.delivery_id);
        return (
          <OverlayView
            key={`dloc-${d.delivery_id}`}
            position={{ lat: d.lat, lng: d.lng }}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
            getPixelPositionOffset={(w, h) => ({ x: -(w / 2), y: -(h / 2) })}
          >
            <div
              className="pointer-events-none flex flex-col items-center"
              data-testid={`delivery-live-${d.delivery_id}`}
              title={`${d.name} - ultima actualizacion`}
            >
              <div className="relative">
                <span className="absolute inset-0 rounded-full animate-ping opacity-60" style={{ background: color }}></span>
                <div
                  className="relative w-9 h-9 rounded-full overflow-hidden border-[3px] shadow-lg bg-white flex items-center justify-center"
                  style={{ borderColor: color }}
                >
                  {d.photo_url ? (
                    <img src={d.photo_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[11px] font-bold text-[#501122]">{(d.name || '?')[0]}</span>
                  )}
                </div>
              </div>
              <span className="mt-0.5 px-1.5 py-0 rounded-full text-white text-[9px] font-bold uppercase tracking-wider shadow-md whitespace-nowrap" style={{ background: color }}>
                {d.name || 'Delivery'}
              </span>
            </div>
          </OverlayView>
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

function DeliveryMapInner({ isLoaded, loadError, orders, title = 'Mapa de Entregas', subtitle, testId = 'delivery-map', hideFutureDays = true, centralPoint = null, expandHref = null, defaultHeight = 320, minimal = false, deliveryLocations = [] }) {
  const [centerRequestId, setCenterRequestId] = useState(0);
  const [fitAllRequestId, setFitAllRequestId] = useState(0);

  // Filter out orders scheduled for a future day so they only appear starting on their scheduled date.
  const visibleOrders = useMemo(() => {
    if (!hideFutureDays) return orders || [];
    return (orders || []).filter(o => !isScheduledForFutureDay(o.scheduled_for));
  }, [orders, hideFutureDays]);

  const validCount = useMemo(
    () => visibleOrders.filter(o => typeof o.lat === 'number' && typeof o.lng === 'number').length,
    [visibleOrders]
  );

  const hasCentral = centralPoint && typeof centralPoint.lat === 'number' && typeof centralPoint.lng === 'number';
  const showMap = validCount > 0 || hasCentral;

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
              <MapBody orders={visibleOrders} height="100%" centralPoint={centralPoint} centerRequestId={centerRequestId} fitAllRequestId={fitAllRequestId} deliveryLocations={deliveryLocations} />
            </div>

            {/* Bottom Center Floating Encuadrar Button */}
            <button
              type="button"
              onClick={() => setFitAllRequestId(id => id + 1)}
              data-testid={`${testId}-fit-all-btn`}
              title="Encuadrar la tienda y todos los pedidos"
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
