import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SafeMapsLoader } from '@/lib/mapsLoader';
import { MapBody, isScheduledForFutureDay } from '@/components/DeliveryMap';
import api from '@/lib/api';
import { Loader2, MapPin, Crosshair } from 'lucide-react';
import { getStoredCentralPoint, syncCentralPointWithBackend } from '@/lib/centralPoint';

function MapViewInner({ isLoaded, loadError }) {
  const [params] = useSearchParams();
  const scope = params.get('scope') || 'admin-pending';
  const [orders, setOrders] = useState([]);
  const [settings, setSettings] = useState({});
  const [deliveryLocations, setDeliveryLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [centerRequestId, setCenterRequestId] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [s, o, dloc] = await Promise.all([
          api.get('/settings'),
          scope === 'delivery-available' ? api.get('/orders/available') : api.get('/orders'),
          api.get('/delivery/locations').catch(() => ({ data: [] })),
        ]);
        setSettings(s.data || {});
        syncCentralPointWithBackend(s.data);
        setOrders(Array.isArray(o.data) ? o.data : []);
        setDeliveryLocations(Array.isArray(dloc.data) ? dloc.data : []);
      } catch (e) { console.warn(e); }
      finally { setLoading(false); }
    })();

    const onLocationUpdate = (e) => {
      const payload = e.detail;
      if (!payload || typeof payload.lat !== 'number' || typeof payload.lng !== 'number') return;
      const driverId = String(payload.driver_id || payload.delivery_id);
      setDeliveryLocations(prevLocations => {
        const list = Array.isArray(prevLocations) ? prevLocations : [];
        const existing = list.find(d => String(d.delivery_id) === driverId);
        const filtered = list.filter(d => String(d.delivery_id) !== driverId);
        return [...filtered, {
          delivery_id: driverId,
          name: payload.name || 'Repartidor',
          lat: payload.lat,
          lng: payload.lng,
          color: payload.color !== undefined ? payload.color : (existing ? existing.color : null),
          photo_url: payload.photo_url !== undefined ? payload.photo_url : (existing ? existing.photo_url : null),
          updated_at: payload.updated_at || new Date().toISOString(),
        }];
      });
    };

    window.addEventListener('lubos:location_update', onLocationUpdate);
    return () => {
      window.removeEventListener('lubos:location_update', onLocationUpdate);
    };
  }, [scope]);

  const centralPoint = useMemo(() => {
    if (settings.central_point_lat && settings.central_point_lng) {
      return { lat: settings.central_point_lat, lng: settings.central_point_lng };
    }
    return getStoredCentralPoint();
  }, [settings]);

  const safeOrders = useMemo(() => (Array.isArray(orders) ? orders : []), [orders]);

  const visibleOrders = useMemo(() => {
    return safeOrders.filter(o => {
      if (!['pendiente', 'en_camino'].includes(o.status) || o.order_type !== 'delivery') return false;
      if (isScheduledForFutureDay(o.scheduled_for)) return false;
      return true;
    });
  }, [safeOrders, scope]);

  const title = scope === 'delivery-available'
    ? 'Mapa de Disponibles'
    : scope === 'delivery-mine'
      ? 'Mapa de Mis Pedidos'
      : 'Mapa de Proximas Entregas';
  const validCount = visibleOrders.filter(o => typeof o.lat === 'number' && typeof o.lng === 'number').length;
  const hasCentral = !!centralPoint;
  const showMap = validCount > 0 || hasCentral;

  return (
    <div className="w-screen h-screen flex flex-col bg-white" data-testid="map-view-page">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#501122]/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <MapPin className="h-4 w-4 text-[#501122] shrink-0" />
          <p className="font-heading text-base text-[#501122] truncate">{title}</p>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#78686C] bg-[#F3EBE0] rounded-full px-2 py-0.5 shrink-0">
            {validCount} {validCount === 1 ? 'pedido' : 'pedidos'}
          </span>
        </div>
        {hasCentral && (
          <button type="button" onClick={() => setCenterRequestId(id => id + 1)} data-testid="map-view-center-btn"
            className="flex items-center gap-1.5 px-3 h-9 rounded-full bg-[#F3EBE0] hover:bg-[#E8DCC8] text-[#501122] text-xs font-semibold transition-colors">
            <Crosshair className="h-3.5 w-3.5" /><span className="hidden sm:inline">Centrar</span>
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0">
        {(loading || !isLoaded) && !loadError && (
          <div className="w-full h-full flex justify-center items-center"><Loader2 className="h-6 w-6 animate-spin text-[#501122]" /></div>
        )}
        {loadError && (
          <p className="text-center py-10 text-[#78686C] text-sm">
            {loadError.message === 'GOOGLE_MAPS_KEY_MISSING'
              ? 'Google Maps no configurado (falta GOOGLE_MAPS_KEY)'
              : 'Error cargando Google Maps'}
          </p>
        )}
        {isLoaded && !loading && !showMap && (
          <p className="text-center py-16 text-[#78686C] text-sm">No hay pedidos con ubicacion para mostrar</p>
        )}
        {isLoaded && !loading && showMap && (
          <MapBody orders={visibleOrders} height="100%" centralPoint={centralPoint} centerRequestId={centerRequestId} deliveryLocations={deliveryLocations} showRoute={true} />
        )}
      </div>
    </div>
  );
}

export default function MapView() {
  return (
    <SafeMapsLoader>
      {({ isLoaded, loadError }) => (
        <MapViewInner isLoaded={isLoaded} loadError={loadError} />
      )}
    </SafeMapsLoader>
  );
}
