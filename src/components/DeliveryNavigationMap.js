import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleMap, Marker, OverlayView, Polyline } from '@react-google-maps/api';
import { SafeMapsLoader, DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLES } from '@/lib/mapsLoader';
import { Loader2, Navigation, MapPin, Compass, AlertCircle, ExternalLink, Plus, Minus, Locate } from 'lucide-react';

// Custom Marker Icons
const DRIVER_MARKER_ICON = {
  path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6z',
  fillColor: '#4285F4',
  fillOpacity: 1,
  strokeColor: '#FFFFFF',
  strokeWeight: 2,
  scale: 1.2,
  anchor: { x: 12, y: 12 },
};

const DESTINATION_MARKER_ICON = {
  path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z',
  fillColor: '#501122',
  fillOpacity: 1,
  strokeColor: '#FFFFFF',
  strokeWeight: 2,
  scale: 1.8,
  anchor: { x: 12, y: 22 },
};

function DeliveryNavigationMapInner({
  isLoaded,
  loadError,
  order,
  centralPoint,
  testId = 'delivery-nav-map',
}) {
  const [mapInstance, setMapInstance] = useState(null);
  const [driverPos, setDriverPos] = useState(null);
  const [geoError, setGeoError] = useState(null);
  const [routePath, setRoutePath] = useState(null);
  const [routeInfo, setRouteInfo] = useState({ distance: '', duration: '' });
  const [userPanned, setUserPanned] = useState(false);

  const destLat = order?.lat;
  const destLng = order?.lng;
  const hasDest = typeof destLat === 'number' && typeof destLng === 'number';

  const defaultStart = centralPoint && typeof centralPoint.lat === 'number' && typeof centralPoint.lng === 'number'
    ? { lat: centralPoint.lat, lng: centralPoint.lng }
    : DEFAULT_CENTER;

  // 1. Live Geolocation Tracking
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoError('Geolocalización no soportada por el navegador');
      return;
    }

    const handleSuccess = (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setDriverPos({ lat, lng });
      setGeoError(null);
    };

    const handleError = (err) => {
      console.warn('Geolocation watch error:', err);
      setGeoError('Permiso de ubicación denegado o no disponible');
    };

    // Initial position fetch
    navigator.geolocation.getCurrentPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 3000,
    });

    // Watch position continuous updates
    const watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 3000,
    });

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // Effective driver location (falls back to store central point if live GPS unavailable)
  const currentStartPos = driverPos || defaultStart;

  // 2. Map Load Callback
  const handleMapLoad = useCallback((map) => {
    setMapInstance(map);
  }, []);

  // Detect manual user drag/pan to pause auto-centering
  const handleDragStart = useCallback(() => {
    setUserPanned(true);
  }, []);

  // 3. Directions Calculation & Bounds Auto-Fit
  useEffect(() => {
    if (!mapInstance || !hasDest || !currentStartPos || !window.google?.maps) return;

    let isCancelled = false;

    const fitBoundsToPoints = (pts) => {
      try {
        const bounds = new window.google.maps.LatLngBounds();
        pts.forEach((p) => bounds.extend(p));
        const isLandscape = window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches;
        const padding = isLandscape
          ? { top: 50, bottom: 50, left: 330, right: 50 }
          : { top: 70, bottom: 200, left: 40, right: 40 };
        mapInstance.fitBounds(bounds, padding);
      } catch (err) {
        /* ignore */
      }
    };

    const straightLineFallback = () => {
      const fallbackPath = [
        currentStartPos,
        { lat: destLat, lng: destLng },
      ];
      setRoutePath(fallbackPath);

      // Estimate distance and driving time using Haversine formula
      const R = 6371;
      const dLat = ((destLat - currentStartPos.lat) * Math.PI) / 180;
      const dLng = ((destLng - currentStartPos.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((currentStartPos.lat * Math.PI) / 180) *
          Math.cos((destLat * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distKm = R * c;
      const estMin = Math.max(1, Math.round((distKm / 20) * 60)); // ~20 km/h city driving speed
      setRouteInfo({
        distance: `${distKm.toFixed(1)} km`,
        duration: `~${estMin} min`,
      });

      if (!userPanned) {
        fitBoundsToPoints(fallbackPath);
      }
    };

    if (!window.google.maps.DirectionsService) {
      straightLineFallback();
      return;
    }

    const svc = new window.google.maps.DirectionsService();
    svc.route(
      {
        origin: currentStartPos,
        destination: { lat: destLat, lng: destLng },
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (isCancelled) return;
        if (status === 'OK' && result?.routes?.[0]) {
          const route = result.routes[0];
          if (route.overview_path) {
            const path = route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
            setRoutePath(path);

            if (route.legs?.[0]) {
              setRouteInfo({
                distance: route.legs[0].distance?.text || '',
                duration: route.legs[0].duration?.text || '',
              });
            }

            if (!userPanned) {
              fitBoundsToPoints([
                ...path,
                currentStartPos,
                { lat: destLat, lng: destLng },
              ]);
            }
          }
        } else {
          straightLineFallback();
        }
      }
    );

    return () => {
      isCancelled = true;
    };
  }, [mapInstance, hasDest, destLat, destLng, currentStartPos.lat, currentStartPos.lng, userPanned]);

  // Helper to center map on point considering landscape left sidebar offset
  const centerMapOnPoint = useCallback((pos, zoomLevel) => {
    if (!mapInstance || !pos) return;
    if (zoomLevel !== undefined) {
      mapInstance.setZoom(zoomLevel);
    }
    mapInstance.panTo(pos);
    const isLandscape = window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches;
    if (isLandscape) {
      setTimeout(() => {
        try {
          mapInstance.panBy(-140, 0);
        } catch (e) {
          /* ignore */
        }
      }, 60);
    }
  }, [mapInstance]);

  // Recenter on Driver
  const handleRecenterDriver = useCallback(() => {
    setUserPanned(false);
    if (currentStartPos) {
      centerMapOnPoint(currentStartPos, 16);
    }
  }, [centerMapOnPoint, currentStartPos]);

  // Zoom controls keeping location centered
  const handleZoomIn = useCallback(() => {
    if (mapInstance && currentStartPos) {
      const z = mapInstance.getZoom() || 15;
      centerMapOnPoint(currentStartPos, z + 1);
    }
  }, [mapInstance, currentStartPos, centerMapOnPoint]);

  const handleZoomOut = useCallback(() => {
    if (mapInstance && currentStartPos) {
      const z = mapInstance.getZoom() || 15;
      centerMapOnPoint(currentStartPos, z - 1);
    }
  }, [mapInstance, currentStartPos, centerMapOnPoint]);

  if (loadError) {
    return (
      <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center p-6 text-center bg-amber-50/50 rounded-2xl border border-amber-200">
        <AlertCircle className="h-8 w-8 text-amber-600 mb-2" />
        <p className="text-sm font-bold text-amber-900">No se pudo cargar Google Maps</p>
        <p className="text-xs text-amber-700 mt-1">Verifica la clave API o la conexión a internet.</p>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-full min-h-[300px] flex flex-col items-center justify-center p-6 bg-gray-50 rounded-2xl">
        <Loader2 className="h-8 w-8 animate-spin text-[#501122] mb-2" />
        <p className="text-xs font-semibold text-[#78686C]">Cargando mapa de navegación...</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-[320px] rounded-2xl overflow-hidden shadow-inner" data-testid={testId}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={currentStartPos}
        zoom={15}
        onLoad={handleMapLoad}
        onDragStart={handleDragStart}
        options={{
          styles: MAP_STYLES,
          disableDefaultUI: true,
          zoomControl: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          gestureHandling: 'greedy',
        }}
      >
        {/* Route Polyline Line */}
        {routePath && (
          <Polyline
            path={routePath}
            options={{
              strokeColor: '#4285F4',
              strokeOpacity: 0.85,
              strokeWeight: 6,
            }}
          />
        )}

        {/* Driver Live Location Marker */}
        {currentStartPos && (
          <Marker
            position={currentStartPos}
            icon={DRIVER_MARKER_ICON}
            title="Tu ubicación (Repartidor)"
            zIndex={100}
          />
        )}

        {/* Driver Position Accuracy Pulse Effect Overlay */}
        {currentStartPos && (
          <OverlayView
            position={currentStartPos}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div className="-translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <span className="relative flex h-8 w-8">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-8 w-8 bg-blue-500/20 border border-blue-500"></span>
              </span>
            </div>
          </OverlayView>
        )}

        {/* Customer Destination Marker */}
        {hasDest && (
          <Marker
            position={{ lat: destLat, lng: destLng }}
            icon={DESTINATION_MARKER_ICON}
            title={order?.customer_name || 'Destino de entrega'}
            zIndex={90}
          />
        )}

        {/* Destination Customer Label overlay */}
        {hasDest && order && (
          <OverlayView
            position={{ lat: destLat, lng: destLng }}
            mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
          >
            <div className="-translate-x-1/2 translate-y-2 pointer-events-none">
              <div className="bg-[#501122] text-white text-[11px] font-bold px-2.5 py-1 rounded-xl shadow-lg border border-white/20 whitespace-nowrap flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-amber-300 shrink-0" />
                <span>{order.customer_name}</span>
              </div>
            </div>
          </OverlayView>
        )}
      </GoogleMap>

      {/* Live Distance & Time Badge (Positioned cleanly below floating header card) */}
      {(routeInfo.distance || routeInfo.duration) && (
        <div className="absolute top-[94px] [@media(orientation:landscape)_and_(max-height:500px)]:top-2.5 left-3 [@media(orientation:landscape)_and_(max-height:500px)]:left-[318px] z-20 bg-[#501122]/95 text-white px-2.5 py-1 rounded-xl shadow-lg border border-white/20 flex items-center gap-1.5 text-[11px] font-extrabold backdrop-blur-sm animate-in fade-in duration-300">
          <Navigation className="h-3 w-3 text-amber-300 fill-current shrink-0" />
          <span>{routeInfo.duration ? `${routeInfo.duration}` : ''}</span>
          {routeInfo.distance && (
            <span className="text-white/80 font-semibold">· {routeInfo.distance}</span>
          )}
        </div>
      )}

      {/* Small Zoom Controls (+ / -) on Center Right */}
      <div className="absolute top-1/2 right-3 -translate-y-1/2 z-20 flex flex-col gap-1 bg-white/95 backdrop-blur-md p-1 rounded-xl border border-[#501122]/15 shadow-md">
        <button
          type="button"
          onClick={handleZoomIn}
          data-testid="zoom-in-map-btn"
          className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-[#501122] active:scale-95 transition-all"
          title="Acercar mapa (+)"
        >
          <Plus className="h-4 w-4" />
        </button>
        <div className="h-[1px] bg-gray-200 w-full" />
        <button
          type="button"
          onClick={handleZoomOut}
          data-testid="zoom-out-map-btn"
          className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-[#501122] active:scale-95 transition-all"
          title="Alejar mapa (-)"
        >
          <Minus className="h-4 w-4" />
        </button>
      </div>

      {/* Recenter Driver Button (Bottom Left Floating) */}
      <button
        type="button"
        onClick={handleRecenterDriver}
        data-testid="recenter-driver-gps-btn"
        className={`absolute bottom-4 left-4 [@media(orientation:landscape)_and_(max-height:500px)]:left-[318px] z-20 px-3 py-2 rounded-xl shadow-xl transition-all active:scale-95 flex items-center gap-1.5 text-xs font-bold ${
          userPanned
            ? 'bg-[#501122] text-white border border-white/20 animate-bounce'
            : 'bg-white/95 backdrop-blur-md text-[#501122] border border-[#501122]/15 hover:bg-white'
        }`}
        title="Centrar en mi ubicación"
      >
        <Locate className="h-4 w-4 shrink-0 text-[#4285F4]" />
        <span>Centrar</span>
      </button>
    </div>
  );
}

export default function DeliveryNavigationMap(props) {
  return (
    <SafeMapsLoader>
      {({ isLoaded, loadError }) => (
        <DeliveryNavigationMapInner isLoaded={isLoaded} loadError={loadError} {...props} />
      )}
    </SafeMapsLoader>
  );
}
