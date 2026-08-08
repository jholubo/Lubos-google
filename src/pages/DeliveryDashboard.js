import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import api, { formatUSD, formatVES } from '@/lib/api';
import { getLocalCache, setLocalCache } from '@/lib/cache';
import { notifyLocalChange } from '@/lib/dataSync';
import { useNotifications } from '@/hooks/useNotifications';
import usePushSubscription from '@/hooks/usePushSubscription';
import DeliveryMap from '@/components/DeliveryMap';
import DeliveryNavigationMap from '@/components/DeliveryNavigationMap';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, MapPin, Check, Truck, Package, BarChart3, Undo2, DollarSign, CheckCircle2, Clock, Calendar, TrendingUp, Phone, ChevronDown, ChevronUp, ShoppingBag, Cake, Hourglass, LogOut, Volume2, VolumeX, Menu, X, Navigation, ExternalLink } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

const statusColors = {
  pendiente: 'bg-[#C27A29]/15 text-[#C27A29]',
  en_camino: 'bg-blue-100 text-blue-700',
  entregado: 'bg-[#3F634A]/15 text-[#3F634A]',
  cancelado: 'bg-red-100 text-red-700',
};
const statusLabels = { pendiente: 'Pendiente', en_camino: 'En Camino', entregado: 'Entregado', cancelado: 'Cancelado' };

// Build the maps URL the delivery opens for navigation. Priority:
//  1) The exact URL the vendor pasted (or the canonical URL we rewrite when the pin
//     is dragged) -> guarantees delivery sees the SAME pin location.
//  2) Coord-based `?q=lat,lng` -> dropped-pin at exact coords (no search-API snap).
//  3) Text search -> last resort when we only have a written address.
function buildMapsHref(order) {
  const addr = order?.delivery_address || '';
  if (addr.startsWith('http')) return addr;
  if (typeof order?.lat === 'number' && typeof order?.lng === 'number') {
    return `https://www.google.com/maps/?q=${order.lat},${order.lng}`;
  }
  if (addr) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  return null;
}

export default function DeliveryDashboard() {
  usePushSubscription();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('disponibles');
  const [orders, setOrders] = useState([]);
  const [availableOrders, setAvailableOrders] = useState([]);
  const [expandedOrderId, setExpandedOrderId] = useState(null);
  const [activeRouteOrder, setActiveRouteOrder] = useState(null);
  const [settings, setSettings] = useState({ exchange_rate_ves: 36.5 });
  const [deliveryStats, setDeliveryStats] = useState(null);
  const [dataPeriod, setDataPeriod] = useState('week');
  const [geoPermissionGranted, setGeoPermissionGranted] = useState(() => {
    return localStorage.getItem('lubos_geo_permission') === 'granted';
  });
  const watchIdRef = useRef(null);
  const lastCoordsRef = useRef(null);
  const lastSentRef = useRef(0);

  const sendLocation = useCallback(async (lat, lng) => {
    const now = Date.now();
    if (now - lastSentRef.current < 12000) return; // rate limit ~12s
    lastSentRef.current = now;
    try { await api.post('/delivery/location', { lat, lng }); }
    catch { /* ignore */ }
  }, []);

  const requestAndStartLocationTracking = useCallback(() => {
    if (!('geolocation' in navigator)) {
      toast.error('Geolocalización no soportada en este navegador');
      return;
    }
    localStorage.setItem('lubos_geo_permission', 'granted');
    setGeoPermissionGranted(true);

    if (watchIdRef.current !== null) return;

    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          lastCoordsRef.current = { lat: latitude, lng: longitude };
          sendLocation(latitude, longitude);
        },
        (err) => { console.warn('[Delivery] geolocation error:', err?.message || err); },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
      );
      toast.success('Ubicación guardada y activa para el delivery');
    } catch (e) { console.warn('[Delivery] watchPosition failed:', e); }
  }, [sendLocation]);
  const { unreadCount } = useNotifications();
  const userName = user?.name || (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').name || ''; } catch { return ''; }
  })();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const loadFast = useCallback(async () => {
    // Instant cache read
    const cMyOrders = getLocalCache('delivery_my_orders');
    if (cMyOrders) setOrders(cMyOrders);
    const cAvailOrders = getLocalCache('delivery_avail_orders');
    if (cAvailOrders) setAvailableOrders(cAvailOrders);

    try {
      const [o, av] = await Promise.all([
        api.get('/orders'),
        api.get('/orders/available').catch(() => ({ data: [] })),
      ]);
      setOrders(o.data); setLocalCache('delivery_my_orders', o.data);
      setAvailableOrders(av.data); setLocalCache('delivery_avail_orders', av.data);
    } catch (e) { console.warn('[Delivery] fast fetch failed:', e?.message || e); }
  }, []);

  const loadSettings = useCallback(async () => {
    const cSettings = getLocalCache('settings');
    if (cSettings) setSettings(cSettings);
    try {
      const { data } = await api.get('/settings');
      setSettings(data);
      setLocalCache('settings', data);
    } catch (e) { console.warn('[Delivery] settings fetch failed:', e?.message || e); }
  }, []);

  // Kept for compatibility with existing action handlers that expect `loadOrders`.
  const loadOrders = loadFast;

  const loadDeliveryStats = useCallback(async () => {
    try {
      const { data } = await api.get('/delivery/stats');
      setDeliveryStats(data);
    } catch (e) { console.warn('[Delivery] stats fetch failed:', e?.message || e); }
  }, []);

  useEffect(() => {
    const refresh = () => { loadFast(); loadDeliveryStats(); };
    refresh();
    loadSettings();
    const interval = setInterval(refresh, 8000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    // Refresco instantaneo cuando llegan notificaciones de pedidos.
    window.addEventListener('lubos:orders-changed', refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('lubos:orders-changed', refresh);
    };
  }, [loadFast, loadDeliveryStats, loadSettings]);

  // Comparte ubicación de forma transparente si el permiso ya fue concedido previamente y guardado.
  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    const savedPerm = localStorage.getItem('lubos_geo_permission');
    if (savedPerm === 'granted') {
      requestAndStartLocationTracking();
    } else if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'geolocation' }).then((res) => {
        if (res.state === 'granted') {
          requestAndStartLocationTracking();
        }
      }).catch(() => {});
    }

    // Fuerza reenvío de posición al volver a primer plano
    const onVisible = () => {
      if (document.visibilityState === 'visible' && lastCoordsRef.current) {
        lastSentRef.current = 0;
        sendLocation(lastCoordsRef.current.lat, lastCoordsRef.current.lng);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    // Re-envía las últimas coordenadas conocidas en segundo plano sin forzar re-solicitud al sistema operativo
    const interval = setInterval(() => {
      if (lastCoordsRef.current) {
        sendLocation(lastCoordsRef.current.lat, lastCoordsRef.current.lng);
      }
    }, 15000);

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [requestAndStartLocationTracking, sendLocation]);

  const updateStatus = async (orderId, status) => {
    const prevOrder = (Array.isArray(orders) ? orders : []).find(o => o.id === orderId);
    
    // 0ms Optimistic UI update
    setOrders(prev => (Array.isArray(prev) ? prev : []).map(o => o.id === orderId ? { ...o, status, delivered_at: status === 'entregado' ? new Date().toISOString() : o.delivered_at } : o));
    notifyLocalChange('orders_changed');
    toast.success(status === 'entregado' ? 'Pedido entregado!' : status === 'pendiente' ? 'Pedido revertido' : 'En camino!');

    try {
      await api.patch(`/orders/${orderId}/status`, { status });
    } catch (err) {
      if (prevOrder) setOrders(prev => (Array.isArray(prev) ? prev : []).map(o => o.id === orderId ? prevOrder : o));
      toast.error(err.response?.data?.detail || 'Error actualizando estado');
    }
  };

  const whatsappMessage = encodeURIComponent("Listo, ya estoy aca en la ubicacion");
  const rate = settings.exchange_rate_ves || 36.5;
  
  const safeOrders = Array.isArray(orders) ? orders : [];
  const currentRouteOrder = useMemo(() => {
    if (!activeRouteOrder) return null;
    return safeOrders.find(o => o.id === activeRouteOrder.id) || activeRouteOrder;
  }, [activeRouteOrder, safeOrders]);
  const activeOrders = safeOrders.filter(o => o.status !== 'entregado' && o.status !== 'cancelado');
  // Expone si el delivery esta LIBRE (sin pedidos activos en Mis Pedidos) para que
  // useNotifications decida que sonido tocar cuando llega uno disponible.
  useEffect(() => {
    if (typeof window !== 'undefined') window.__lubosDeliveryFree = activeOrders.length === 0;
  }, [activeOrders.length]);
  const completedOrders = safeOrders.filter(o => o.status === 'entregado');

  // Helper: classify a scheduled order. Returns null when there is no schedule (treat as ASAP).
  // Otherwise returns:
  //  - { kind: 'today_later', label: 'Para HH:mm', sortKey }: scheduled later TODAY (still actionable)
  //  - { kind: 'future', label: 'Para DD/MM HH:mm', sortKey }: scheduled for a future DAY (locked)
  //  - { kind: 'today_now_or_past', sortKey }: scheduled time already arrived
  const getScheduleInfo = (order) => {
    if (!order.scheduled_for) return null;
    const sched = new Date(order.scheduled_for);
    if (isNaN(sched.getTime())) return null;
    const nowVE = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const schedVE = new Date(sched.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const sameDay = nowVE.getFullYear() === schedVE.getFullYear()
      && nowVE.getMonth() === schedVE.getMonth()
      && nowVE.getDate() === schedVE.getDate();
    const futureDay = schedVE > nowVE && !sameDay;
    const hhmm = sched.toLocaleString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: false });
    const ddmm = sched.toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit' });
    if (futureDay) return { kind: 'future', label: `Para ${ddmm} ${hhmm}`, sortKey: sched.getTime() };
    if (sameDay && schedVE > nowVE) return { kind: 'today_later', label: `Para las ${hhmm}`, sortKey: sched.getTime() };
    return { kind: 'today_now_or_past', label: `Programado ${hhmm}`, sortKey: sched.getTime() };
  };

  // Sort: ASAP (no schedule) first by creation, then today-later (chronological), then future-locked at the bottom.
  const orderByScheduleAsc = (a, b) => {
    const sa = getScheduleInfo(a);
    const sb = getScheduleInfo(b);
    const groupRank = (s) => {
      if (!s || s.kind === 'today_now_or_past') return 0; // actionable now
      if (s.kind === 'today_later') return 1;             // later today
      return 2;                                             // future day (locked)
    };
    const ra = groupRank(sa);
    const rb = groupRank(sb);
    if (ra !== rb) return ra - rb;
    const ka = sa?.sortKey ?? new Date(a.created_at).getTime();
    const kb = sb?.sortKey ?? new Date(b.created_at).getTime();
    return ka - kb;
  };

  // Available orders priority: 1) Ready in queue now, 2) Scheduled for later, 3) Blocked waiting for notice
  const orderByAvailablePriority = (a, b) => {
    const getPriorityRank = (o) => {
      if (o.wait_for_notice) return 3; // Blocked waiting for notice at the end
      const s = getScheduleInfo(o);
      if (s && (s.kind === 'today_later' || s.kind === 'future')) return 2; // Scheduled for later
      return 1; // In queue ready to go
    };
    const ra = getPriorityRank(a);
    const rb = getPriorityRank(b);
    if (ra !== rb) return ra - rb;
    const sa = getScheduleInfo(a);
    const sb = getScheduleInfo(b);
    const ka = sa?.sortKey ?? new Date(a.created_at).getTime();
    const kb = sb?.sortKey ?? new Date(b.created_at).getTime();
    return ka - kb;
  };

  const sortedActiveOrders = [...activeOrders].sort(orderByScheduleAsc);
  const sortedAvailableOrders = [...availableOrders].sort(orderByAvailablePriority);

  const todayStats = useMemo(() => {
    // Cuenta entregados HOY (VE timezone) por delivered_at; si falta, fallback a updated_at.
    const nowVE = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    const sameVeDay = (iso) => {
      if (!iso) return false;
      try {
        const d = new Date(iso);
        const dve = new Date(d.toLocaleString('en-US', { timeZone: 'America/Caracas' }));
        return dve.getFullYear() === nowVE.getFullYear()
          && dve.getMonth() === nowVE.getMonth()
          && dve.getDate() === nowVE.getDate();
      } catch { return false; }
    };
    const deliveredToday = safeOrders.filter(o => o.status === 'entregado' && sameVeDay(o.delivered_at || o.updated_at));
    // Pendientes = todos los actualmente abiertos asignados a este delivery (pendiente o en_camino)
    const pendingOpen = safeOrders.filter(o => o.status === 'pendiente' || o.status === 'en_camino');
    return {
      delivered: deliveredToday.length,
      pending: pendingOpen.length,
      revenue: deliveredToday.reduce((sum, o) => sum + (o.delivery_fee || 0), 0),
    };
  }, [orders]);

  const navItems = [
    { id: 'disponibles', icon: ShoppingBag, label: 'Disponibles' },
    { id: 'entregas', icon: Package, label: 'Mis Pedidos' },
    { id: 'data', icon: BarChart3, label: 'Data' },
  ];

  const releaseOrder = async (orderId) => {
    const targetOrder = (Array.isArray(orders) ? orders : []).find(o => o.id === orderId);

    // 0ms Optimistic UI update: move from orders -> availableOrders
    setOrders(prev => (Array.isArray(prev) ? prev : []).filter(o => o.id !== orderId));
    if (targetOrder) {
      setAvailableOrders(prev => [...(Array.isArray(prev) ? prev : []), { ...targetOrder, delivery_id: null, delivery_name: null }]);
    }
    notifyLocalChange('orders_changed');
    toast.success('Pedido devuelto a Disponibles');

    try {
      await api.post(`/orders/${orderId}/unassign-delivery`);
    } catch (e) {
      if (targetOrder) {
        setOrders(prev => [...(Array.isArray(prev) ? prev : []), targetOrder]);
        setAvailableOrders(prev => (Array.isArray(prev) ? prev : []).filter(o => o.id !== orderId));
      }
      toast.error(e?.response?.data?.detail || 'Error al liberar pedido');
    }
  };

  const takeOrder = async (order) => {
    if (order.wait_for_notice) {
      toast.error('Este pedido tiene "esperar aviso" activo y no se puede tomar aún');
      return;
    }

    // 0ms Optimistic UI update: move from availableOrders -> orders
    setAvailableOrders(prev => (Array.isArray(prev) ? prev : []).filter(o => o.id !== order.id));
    setOrders(prev => [...(Array.isArray(prev) ? prev : []), { ...order, delivery_id: user?.id, delivery_name: user?.name || 'Delivery' }]);
    notifyLocalChange('orders_changed');
    toast.success('Pedido tomado. Toca "Salir a Entregar" para avisarle al cliente.');

    try {
      await api.post(`/orders/${order.id}/take`);
    } catch (e) {
      setOrders(prev => (Array.isArray(prev) ? prev : []).filter(o => o.id !== order.id));
      setAvailableOrders(prev => [...(Array.isArray(prev) ? prev : []), order]);
      toast.error(e?.response?.data?.detail || 'Error tomando pedido');
    }
  };

  // Group orders by VE date (scheduled_for or created_at) for "ordered by day"
  const groupedByDay = useMemo(() => {
    const today = new Date().toLocaleDateString('es-VE', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' });
    const groups = { today: [], future: {} };
    safeOrders.filter(o => o.status !== 'entregado' && o.status !== 'cancelado').forEach(o => {
      const ref = o.scheduled_for || o.created_at;
      const d = new Date(ref).toLocaleDateString('es-VE', { timeZone: 'America/Caracas', year: 'numeric', month: '2-digit', day: '2-digit' });
      if (d === today || d < today) groups.today.push(o);
      else { groups.future[d] = groups.future[d] || []; groups.future[d].push(o); }
    });
    return groups;
  }, [orders]);

  const callCustomer = (phone) => {
    const clean = (phone || '').replace(/[^0-9+]/g, '');
    window.location.href = `tel:${clean}`;
  };

  return (
    <div className="space-y-3 md:space-y-5 pb-20 md:pb-6">
      {/* Mobile Header Bar (Logo, Repartidor Info & Icon Actions: Data & Logout) */}
      <div className="md:hidden flex items-center justify-between gap-2 bg-white rounded-2xl border border-[#501122]/10 p-2.5 px-4 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src="/logo.svg" alt="Lubo's" className="h-6 w-auto shrink-0" />
          <div className="h-4 w-px bg-[#501122]/15 shrink-0" />
          <div className="min-w-0">
            <p className="font-heading text-xs text-[#501122] font-bold leading-tight truncate">{userName}</p>
            <p className="text-[9px] font-semibold uppercase tracking-wider text-[#78686C]">Repartidor</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Data / Stats Icon Button */}
          <button
            onClick={() => setActiveSection('data')}
            data-testid="mobile-data-btn"
            title="Estadísticas y Data"
            className={`p-2.5 rounded-xl transition-all active:scale-95 ${
              activeSection === 'data'
                ? 'bg-[#501122] text-white shadow-sm'
                : 'bg-[#501122]/5 text-[#501122] hover:bg-[#501122]/10'
            }`}
          >
            <BarChart3 className="h-5 w-5" />
          </button>

          {/* Logout Icon Button */}
          <button
            onClick={handleLogout}
            data-testid="mobile-delivery-logout-btn"
            title="Cerrar sesión"
            className="p-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-100 transition-colors active:scale-95"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Desktop Header Bar (Logo, Nav Tabs & Logout) */}
      <div className="hidden md:flex items-center justify-between gap-4 bg-white rounded-[1.5rem] border border-[#501122]/10 p-3 px-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="Lubo's" className="h-7 w-auto" />
          <div className="h-5 w-px bg-[#501122]/15" />
          <div>
            <p className="font-heading text-sm text-[#501122] font-bold leading-tight">{userName}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#78686C]">Repartidor</p>
          </div>
        </div>

        {/* Pill Tabs */}
        <div className="flex gap-1 bg-[#F0E4D8] rounded-full p-1.5">
          {navItems.map(n => (
            <button key={n.id} onClick={() => setActiveSection(n.id)} data-testid={`delivery-tab-${n.id}`}
              className={`flex items-center gap-2 px-5 py-2 rounded-full text-xs font-semibold transition-all duration-300
                ${activeSection === n.id ? 'bg-white text-[#501122] shadow-sm' : 'text-[#78686C] hover:text-[#501122]'}`}>
              <n.icon className="h-4 w-4" />{n.label}
            </button>
          ))}
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleLogout}
            data-testid="desktop-delivery-logout-btn"
            className="flex items-center gap-2 bg-[#501122]/10 hover:bg-[#501122] hover:text-white text-[#501122] px-4 py-2 rounded-full font-bold text-xs transition-all duration-200 active:scale-95 shadow-sm"
            title="Cerrar Sesión"
          >
            <LogOut className="h-4 w-4" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>

      {/* Banner de Permiso de Ubicación (Solo si no se ha concedido aún) */}
      {!geoPermissionGranted && (
        <div className="bg-amber-50 border border-amber-200/80 rounded-2xl p-3 px-4 flex items-center justify-between gap-3 shadow-xs" data-testid="geo-permission-banner">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
              <Navigation className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#501122]">Permitir compartir ubicación</p>
              <p className="text-[11px] text-[#78686C] truncate">Actívalo 1 sola vez para que los clientes y el panel puedan ver tu ruta en tiempo real.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestAndStartLocationTracking}
            className="shrink-0 px-4 py-2 rounded-full bg-[#501122] hover:bg-[#3D0C19] text-white text-xs font-bold active:scale-95 transition-all shadow-sm flex items-center gap-1.5"
            data-testid="enable-gps-btn"
          >
            <Navigation className="h-3.5 w-3.5" />
            <span>Activar GPS</span>
          </button>
        </div>
      )}

      {/* DISPONIBLES - simplified: name + location + take button */}
      {activeSection === 'disponibles' && (
        <div className="space-y-3">
          {/* Mapa de pedidos sin tomar */}
          <DeliveryMap
            orders={availableOrders}
            title="Mapa de Disponibles"
            subtitle="Pedidos sin asignar (solo hoy). Util para agruparlos por zona y entregarlos juntos."
            testId="delivery-disponibles-map"
            hideFutureDays={true}
            centralPoint={settings.central_point_lat && settings.central_point_lng ? { lat: settings.central_point_lat, lng: settings.central_point_lng } : null}
            expandHref="/map-view?scope=delivery-available"
          />
          {availableOrders.length === 0 ? (
            <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-10 text-center" data-testid="no-available">
              <ShoppingBag className="h-10 w-10 text-[#78686C] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#501122]">No hay pedidos disponibles ahora</p>
              <p className="text-xs text-[#78686C] mt-1">Te aparecera aqui cuando llegue uno nuevo.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 gap-3">
              {sortedAvailableOrders.map(order => {
                const sched = getScheduleInfo(order);
                const isWaitForNotice = !!order.wait_for_notice;
                const locked = sched?.kind === 'future' || isWaitForNotice;
                const mapsHref = buildMapsHref(order);
                return (
                <div key={order.id}
                  className={`rounded-[1.5rem] border shadow-[0_8px_30px_rgba(80,17,34,0.03)] overflow-hidden transition-all ${
                    locked 
                      ? 'bg-gray-100/90 border-gray-300/80 opacity-60 grayscale pointer-events-none select-none' 
                      : 'bg-white border-[#501122]/10'
                  }`}
                  data-testid={`available-${order.id}`}>
                  <div className="p-4 space-y-3">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-[#501122] text-lg min-w-0 truncate">{order.customer_name}</p>
                          {isWaitForNotice && (
                            <p className="text-[11px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1 mt-0.5" data-testid={`available-wait-notice-${order.id}`}>
                              <Hourglass className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                              Esperar aviso activo (Bloqueado)
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span className="text-xs font-bold text-[#3F634A] bg-[#3F634A]/10 border border-[#3F634A]/20 px-2.5 py-1 rounded-full">
                            Ganancia: {formatUSD(order.delivery_fee || 0)}
                          </span>
                          {isWaitForNotice ? (
                            <Badge className="bg-amber-700 text-white rounded-full px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border-0 flex items-center gap-1">
                              <Hourglass className="h-3 w-3" /> Bloqueado
                            </Badge>
                          ) : locked ? (
                            <Badge className="bg-[#78686C] text-white rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border-0">Bloqueado</Badge>
                          ) : null}
                        </div>
                      </div>
                      {sched && (
                        <p className={`text-xs font-semibold flex items-center gap-1 mt-1 ${sched.kind === 'future' ? 'text-[#78686C]' : 'text-[#C27A29]'}`}>
                          <Clock className="h-3.5 w-3.5" />{sched.label}
                        </p>
                      )}
                    </div>
                    {order.notes && (
                      <div className="bg-[#C27A29]/10 border border-[#C27A29]/20 rounded-2xl px-3 py-2" data-testid={`av-notes-${order.id}`}>
                        <p className="text-xs text-[#C27A29] leading-snug"><span className="font-bold">Nota:</span> {order.notes}</p>
                      </div>
                    )}
                    {(order.receiver_name || order.receiver_phone) && (
                      <div className="bg-[#501122]/5 border border-[#501122]/15 rounded-2xl px-3 py-2" data-testid={`av-receiver-${order.id}`}>
                        <p className="text-xs text-[#501122] leading-snug">
                          <span className="font-bold">Recibe otra persona:</span>{' '}
                          {order.receiver_name || 'Sin nombre'}
                          {order.receiver_phone ? ` \u00b7 ${order.receiver_phone}` : ''}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Split Action Bar flush at bottom */}
                  <div className="border-t border-[#501122]/10 flex w-full divide-x divide-white/20 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => takeOrder(order)}
                      disabled={locked}
                      data-testid={`take-${order.id}`}
                      className="flex-1 flex items-center justify-center gap-1.5 h-11 bg-[#501122] hover:bg-[#3D0C19] text-white active:opacity-90 transition-all px-3 disabled:opacity-50 disabled:bg-gray-400"
                    >
                      <span>{isWaitForNotice ? 'Esperando aviso...' : 'Tomar pedido'}</span>
                    </button>
                    <a
                      href={mapsHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`av-maps-${order.id}`}
                      title="Ver ubicacion"
                      className="w-14 shrink-0 flex items-center justify-center h-11 bg-[#4285F4] hover:bg-[#3367D6] text-white active:opacity-90 transition-all"
                    >
                      <MapPin className="h-4 w-4" />
                    </a>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ENTREGAS */}
      {activeSection === 'entregas' && (
        <div className="space-y-5">
          {/* Compact Stats Row with Vertical Dividers */}
          <div className="bg-white rounded-2xl border border-[#501122]/10 p-2.5 shadow-sm flex items-center divide-x divide-[#501122]/15">
            <div className="flex-1 text-center px-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#78686C]">Pendientes</p>
              <p className="font-heading text-xl font-bold text-[#C27A29] mt-0.5">{todayStats.pending}</p>
            </div>
            <div className="flex-1 text-center px-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#78686C]">Hoy</p>
              <p className="font-heading text-xl font-bold text-[#3F634A] mt-0.5">{todayStats.delivered}</p>
            </div>
            <div className="flex-1 text-center px-2">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#78686C]">Ganado</p>
              <p className="font-heading text-lg font-bold text-[#501122] mt-0.5">{formatUSD(todayStats.revenue)}</p>
            </div>
          </div>

          {/* Map of my active orders */}
          <DeliveryMap
            orders={activeOrders}
            title="Mapa de Mis Pedidos"
            subtitle="Pedidos que tienes tomados (pendientes y en camino)."
            testId="delivery-mine-map"
            centralPoint={settings.central_point_lat && settings.central_point_lng ? { lat: settings.central_point_lat, lng: settings.central_point_lng } : null}
            expandHref="/map-view?scope=delivery-mine"
          />

          {/* Active Orders */}
          {activeOrders.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-[2rem] border border-[#501122]/10 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
              <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-[#3F634A]/20" />
              <p className="font-heading text-lg text-[#501122]/50">Sin pedidos pendientes</p>
              <p className="text-sm text-[#78686C] mt-1">Buen trabajo!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 [@media(orientation:landscape)_and_(max-height:500px)]:grid-cols-2 sm:grid-cols-2 lg:grid-cols-2 gap-4">
              {sortedActiveOrders.map(order => {
                const itemsSummary = order.items?.map(i => `${i.quantity}x ${i.flavor_name}`).join(', ') || '';
                const phoneDigits = (order.customer_phone || '').replace(/[^0-9]/g, '');
                const mapsHref = buildMapsHref(order);
                const sched = getScheduleInfo(order);
                const locked = sched?.kind === 'future';
                return (
                <div key={order.id} className={`bg-white rounded-[1.5rem] border border-[#501122]/10 shadow-[0_8px_30px_rgba(80,17,34,0.03)] overflow-hidden transition-all duration-300 hover:-translate-y-0.5 ${locked ? 'opacity-50 pointer-events-none' : ''}`} data-testid={`delivery-order-${order.id}`}>
                  {/* Card Header */}
                  <div className="w-full p-4 flex justify-between items-start gap-3 text-left">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-[#78686C] block">{order.order_number}</span>
                      </div>
                      <p className="font-heading text-lg text-[#501122] truncate">{order.customer_name}</p>
                      {order.wait_for_notice && (
                        <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1 mt-0.5" data-testid={`delivery-order-wait-notice-${order.id}`}>
                          <Hourglass className="h-3 w-3 shrink-0 text-gray-500" />
                          esperar aviso
                        </p>
                      )}
                      <p className="text-xs text-[#78686C] truncate" title={itemsSummary}>{itemsSummary}</p>
                      {sched && (
                        <p className={`text-[11px] font-semibold flex items-center gap-1 mt-1 ${locked ? 'text-[#78686C]' : 'text-[#C27A29]'}`} data-testid={`schedule-badge-${order.id}`}>
                          <Clock className="h-3 w-3" />{sched.label}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            releaseOrder(order.id);
                          }}
                          title="Devolver pedido a Disponibles"
                          data-testid={`release-order-btn-${order.id}`}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 border border-amber-500/30 text-xs font-bold transition-all active:scale-95"
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                          <span className="text-[10px] hidden sm:inline">Devolver</span>
                        </button>
                        <span className="inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full bg-[#3F634A]/10 text-[#3F634A] border border-[#3F634A]/20 text-xs font-extrabold font-mono" title="Ganancia del delivery">
                          {formatUSD(order.delivery_fee || 0)}
                        </span>
                      </div>
                      {locked
                        ? <Badge className="bg-[#78686C] text-white rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border-0">Bloqueado</Badge>
                        : <Badge className={`${statusColors[order.status]} rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border-0`}>{statusLabels[order.status]}</Badge>}
                    </div>
                  </div>

                  {/* Meta chips (notas y receptor alterno) */}
                  {(order.notes || order.receiver_name || order.receiver_phone) && (
                    <div className="px-4 pb-3 space-y-2" data-testid={`always-meta-${order.id}`}>
                      {order.notes && (
                        <div className="bg-[#C27A29]/10 border border-[#C27A29]/20 rounded-xl px-3 py-1.5" data-testid={`mine-notes-${order.id}`}>
                          <p className="text-xs text-[#C27A29] leading-snug"><span className="font-bold">Nota:</span> {order.notes}</p>
                        </div>
                      )}
                      {(order.receiver_name || order.receiver_phone) && (
                        <div className="bg-[#501122]/5 border border-[#501122]/15 rounded-xl px-3 py-1.5 flex items-center justify-between gap-2" data-testid={`mine-receiver-${order.id}`}>
                          <p className="text-xs text-[#501122] leading-snug min-w-0">
                            <span className="font-bold">Recibe otra persona:</span>{' '}
                            {order.receiver_name || 'Sin nombre'}
                            {order.receiver_phone ? ` \u00b7 ${order.receiver_phone}` : ''}
                          </p>
                          {order.receiver_phone && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const rDigits = (order.receiver_phone || '').replace(/[^0-9]/g, '');
                                const g = (order.customer_gender || '').toUpperCase();
                                const treat = (g === 'F' || g === 'MUJER') ? ' querida' : ((g === 'M' || g === 'HOMBRE') ? ' hermano' : '');
                                const msg = `*Delivery de Lubo's Tiramisu*\nPedido de ${order.customer_name || ''}\n\nHola${treat}, un gusto, es ${userName}. Ya voy saliendo para su ubicación para que estes pendiente🤎`;
                                window.open(`https://wa.me/${rDigits}?text=${encodeURIComponent(msg)}`, '_blank');
                              }}
                              data-testid={`mine-receiver-wa-${order.id}`}
                              className="shrink-0 flex items-center gap-1 h-7 px-2.5 rounded-full bg-[#25D366] hover:bg-[#20BF5B] text-white text-[10px] font-semibold shadow-sm active:scale-95 transition-all"
                              title="Enviar WhatsApp al que recibe"
                            >
                              <MessageCircle className="h-3 w-3" />WhatsApp
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Split 2-part Action Bar (Flush at bottom of card) */}
                  <div className="border-t border-[#501122]/10 flex w-full divide-x divide-white/20 text-xs font-bold">
                    <button
                      type="button"
                      onClick={() => {
                        const targetPhone = order.receiver_phone || order.customer_phone || '';
                        const pDigits = targetPhone.replace(/[^0-9]/g, '');
                        const g = (order.customer_gender || '').toUpperCase();
                        const treat = (g === 'F' || g === 'MUJER') ? ' querida' : ((g === 'M' || g === 'HOMBRE') ? ' hermano' : '');
                        const msg = `*Delivery de Lubo's Tiramisu*\nPedido de ${order.customer_name || ''}\n\nHola${treat}, un gusto, es ${userName}. Ya voy saliendo para su ubicación para que estes pendiente🤎`;
                        window.open(`https://wa.me/${pDigits}?text=${encodeURIComponent(msg)}`, '_blank');
                      }}
                      data-testid={`notify-client-btn-${order.id}`}
                      className="flex-1 flex items-center justify-center gap-1.5 h-11 bg-[#25D366] hover:bg-[#20BF5B] text-white active:opacity-90 transition-all px-2"
                    >
                      <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Avisar al cliente</span>
                    </button>

                    <button
                      type="button"
                      onClick={async () => {
                        if (order.status === 'pendiente') {
                          await updateStatus(order.id, 'en_camino');
                        }
                        setActiveRouteOrder(order);
                      }}
                      data-testid={`start-route-btn-${order.id}`}
                      className="flex-1 flex items-center justify-center gap-1.5 h-11 bg-[#501122] hover:bg-[#3D0C19] text-white active:opacity-90 transition-all px-2"
                    >
                      <Navigation className="h-3.5 w-3.5 shrink-0 fill-current" />
                      <span className="truncate">{order.status === 'en_camino' ? 'Ver ruta' : 'Comenzar ruta'}</span>
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}

          {/* Completed Orders */}
          {completedOrders.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-heading text-base text-[#78686C] flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                Completados ({completedOrders.length})
              </h3>
              <div className="space-y-2">
                {completedOrders.slice(0, 5).map(order => (
                  <div key={order.id} className="bg-white/80 border border-[#501122]/10 rounded-2xl p-4 flex justify-between items-center" 
                    data-testid={`completed-order-${order.id}`}>
                    <div>
                      <span className="text-[10px] font-mono text-[#78686C] block">{order.order_number}</span>
                      <p className="font-medium text-[#501122]/70 text-sm">{order.customer_name}</p>
                      <p className="text-xs text-[#78686C]">{order.items?.map(i => `${i.flavor_name} x${i.quantity}`).join(', ')}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-heading text-[#3F634A]/80">{formatUSD(order.delivery_fee || 0)}</span>
                      <Button variant="ghost" size="sm" onClick={() => updateStatus(order.id, 'pendiente')}
                        className="text-[#78686C] hover:text-[#501122] hover:bg-[#501122]/5 h-8 w-8 rounded-full p-0" 
                        data-testid={`revert-btn-${order.id}`}>
                        <Undo2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* DATA */}
      {activeSection === 'data' && (
        <div className="space-y-5">
          <h2 className="font-heading text-2xl text-[#501122]" data-testid="data-title">Mi Resumen</h2>

          {/* Period Selector */}
          <div className="flex gap-2 bg-[#F0E4D8] rounded-full p-1.5 w-fit">
            {[
              { id: 'today', label: 'Hoy', icon: Clock },
              { id: 'week', label: '7 dias', icon: Calendar },
              { id: 'month', label: 'Mes', icon: TrendingUp },
              { id: 'all', label: 'Total', icon: BarChart3 },
            ].map(p => (
              <button key={p.id} onClick={() => setDataPeriod(p.id)} data-testid={`data-period-${p.id}`}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-300
                  ${dataPeriod === p.id ? 'bg-white text-[#501122] shadow-sm' : 'text-[#78686C] hover:text-[#501122]'}`}>
                <p.icon className="h-3.5 w-3.5" />{p.label}
              </button>
            ))}
          </div>

          {/* Stats Grid based on period */}
          {dataPeriod === 'today' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-[#3F634A] flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="font-heading text-3xl text-[#501122]">{todayStats.delivered}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Entregados</p>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-[#C27A29] flex items-center justify-center">
                    <Clock className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <p className="font-heading text-3xl text-[#501122]">{todayStats.pending}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Pendientes</p>
                  </div>
                </div>
              </div>
              <div className="bg-[#501122] rounded-[1.5rem] p-5 col-span-2 shadow-[0_8px_30px_rgba(80,17,34,0.12)]">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center">
                    <DollarSign className="h-7 w-7 text-white" />
                  </div>
                  <div>
                    <p className="font-heading text-3xl text-white">{formatUSD(todayStats.revenue)}</p>
                    <p className="text-sm text-white/50">{formatVES(todayStats.revenue, rate)}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40 mt-0.5">Ganado hoy</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {dataPeriod === 'week' && deliveryStats && (
            <div className="space-y-4">
              {/* Week summary cards */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Entregas 7 dias</p>
                  <p className="font-heading text-3xl text-[#501122] mt-1">{deliveryStats.week.total_delivered}</p>
                </div>
                <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Ganado 7 dias</p>
                  <p className="font-heading text-2xl text-[#501122] mt-1">{formatUSD(deliveryStats.week.total_revenue)}</p>
                  <p className="text-[11px] text-[#78686C]">{formatVES(deliveryStats.week.total_revenue, rate)}</p>
                </div>
              </div>

              {/* Bar chart */}
              <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-4">Entregas por dia</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={deliveryStats.week.daily}>
                    <XAxis dataKey="date" tick={{ fill: '#78686C', fontSize: 10 }} tickFormatter={v => { const d = new Date(v + 'T12:00:00'); return d.toLocaleDateString('es-VE', { weekday: 'short' }); }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#78686C', fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 16, borderColor: 'rgba(80,17,34,0.1)', fontFamily: 'Outfit' }} formatter={(v) => [v, 'Entregas']} labelFormatter={(v) => new Date(v + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' })} />
                    <Bar dataKey="count" fill="#501122" radius={[8, 8, 0, 0]} name="Entregas" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Revenue chart */}
              <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-4">Ganado por dia (USD)</p>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={deliveryStats.week.daily}>
                    <XAxis dataKey="date" tick={{ fill: '#78686C', fontSize: 10 }} tickFormatter={v => { const d = new Date(v + 'T12:00:00'); return d.toLocaleDateString('es-VE', { weekday: 'short' }); }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: '#78686C', fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ borderRadius: 16, borderColor: 'rgba(80,17,34,0.1)', fontFamily: 'Outfit' }} formatter={(v) => [formatUSD(v), 'Ganado']} labelFormatter={(v) => new Date(v + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' })} />
                    <Bar dataKey="revenue" fill="#3F634A" radius={[8, 8, 0, 0]} name="USD" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Daily breakdown list */}
              <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-3">Desglose diario</p>
                <div className="space-y-2">
                  {[...deliveryStats.week.daily].reverse().map(day => (
                    <div key={day.date} className="flex items-center justify-between py-2.5 border-b border-[#501122]/5 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-[#1F1517]">
                          {new Date(day.date + 'T12:00:00').toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' })}
                        </p>
                        <p className="text-xs text-[#78686C]">{day.count} {day.count === 1 ? 'entrega' : 'entregas'}</p>
                      </div>
                      <span className="font-heading text-[#501122]">{formatUSD(day.revenue)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {dataPeriod === 'month' && deliveryStats && (
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-[#501122] rounded-[1.5rem] p-6 shadow-[0_8px_30px_rgba(80,17,34,0.12)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">Total del mes</p>
                <p className="font-heading text-4xl text-white mt-2">{formatUSD(deliveryStats.month.revenue)}</p>
                <p className="text-sm text-white/50 mt-1">{formatVES(deliveryStats.month.revenue, rate)}</p>
              </div>
              <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-[#3F634A] flex items-center justify-center">
                    <CheckCircle2 className="h-7 w-7 text-white" />
                  </div>
                  <div>
                    <p className="font-heading text-4xl text-[#501122]">{deliveryStats.month.delivered}</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mt-0.5">Entregas este mes</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {dataPeriod === 'all' && deliveryStats && (
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-[#501122] rounded-[1.5rem] p-6 shadow-[0_8px_30px_rgba(80,17,34,0.12)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">Total historico</p>
                <p className="font-heading text-4xl text-white mt-2">{formatUSD(deliveryStats.all_time.revenue)}</p>
                <p className="text-sm text-white/50 mt-1">{formatVES(deliveryStats.all_time.revenue, rate)}</p>
              </div>
              <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-[#3F634A] flex items-center justify-center">
                    <Package className="h-7 w-7 text-white" />
                  </div>
                  <div>
                    <p className="font-heading text-4xl text-[#501122]">{deliveryStats.all_time.delivered}</p>
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mt-0.5">Entregas totales</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Delivery History */}
          <div className="space-y-3">
            <h3 className="font-heading text-base text-[#78686C]">Historial de Entregas</h3>
            {completedOrders.length === 0 ? (
              <p className="text-center py-16 text-[#78686C]">No hay entregas completadas</p>
            ) : (
              <div className="space-y-2">
                {completedOrders.map(order => (
                  <div key={order.id} className="bg-white border border-[#501122]/10 rounded-2xl p-4 shadow-[0_4px_15px_rgba(80,17,34,0.02)]" data-testid={`history-order-${order.id}`}>
                    <div className="flex justify-between items-start mb-1.5">
                      <div>
                        <p className="font-medium text-[#501122] text-sm">{order.customer_name}</p>
                        <p className="text-xs text-[#78686C]">{order.items?.map(i => `${i.flavor_name} x${i.quantity}`).join(', ')}</p>
                      </div>
                      <span className="font-heading text-[#3F634A]">{formatUSD(order.delivery_fee || 0)}</span>
                    </div>
                    <p className="text-[10px] text-[#78686C]">
                      {new Date(order.created_at).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mobile Fixed Bottom Navigation Bar (Split 50/50: Disponibles & Mis Pedidos) */}
      <div className="fixed bottom-0 left-0 right-0 md:hidden bg-white border-t border-[#501122]/20 shadow-[0_-8px_30px_rgba(0,0,0,0.18)] h-12 flex z-50 overflow-hidden">
        {/* Disponibles Half */}
        <button
          onClick={() => setActiveSection('disponibles')}
          data-testid="mobile-tab-disponibles"
          title="Disponibles"
          className={`flex-1 flex items-center justify-center gap-1.5 relative h-full border-r border-[#501122]/15 font-bold transition-colors ${
            activeSection === 'disponibles'
              ? 'bg-[#501122] text-white'
              : 'bg-white text-[#501122] hover:bg-[#501122]/5'
          }`}
        >
          <Package className="h-5 w-5" />
          {availableOrders.length > 0 && (
            <span className={`px-1.5 py-0.2 min-w-[18px] text-[10px] font-extrabold rounded-full text-center ${
              activeSection === 'disponibles' ? 'bg-amber-400 text-[#501122]' : 'bg-[#C27A29] text-white'
            }`}>
              {availableOrders.length}
            </span>
          )}
        </button>

        {/* Mis Pedidos Half */}
        <button
          onClick={() => setActiveSection('entregas')}
          data-testid="mobile-tab-entregas"
          title="Mis Pedidos"
          className={`flex-1 flex items-center justify-center gap-1.5 relative h-full font-bold transition-colors ${
            activeSection === 'entregas'
              ? 'bg-[#501122] text-white'
              : 'bg-white text-[#501122] hover:bg-[#501122]/5'
          }`}
        >
          <Truck className="h-5 w-5" />
          {activeOrders.length > 0 && (
            <span className={`px-1.5 py-0.2 min-w-[18px] text-[10px] font-extrabold rounded-full text-center ${
              activeSection === 'entregas' ? 'bg-emerald-400 text-[#501122]' : 'bg-[#3F634A] text-white'
            }`}>
              {activeOrders.length}
            </span>
          )}
        </button>
      </div>

      {/* Full-Screen Route Navigation View */}
      {currentRouteOrder && (
        <div className="fixed inset-0 z-50 bg-[#FBF7F0] flex flex-col overflow-hidden animate-in fade-in duration-200" data-testid="route-navigation-modal">
          {/* Compact Top Header Floating Card */}
          <div className="absolute top-2.5 left-2.5 right-2.5 [@media(orientation:landscape)_and_(max-height:500px)]:right-auto [@media(orientation:landscape)_and_(max-height:500px)]:w-[300px] z-30 bg-white/95 backdrop-blur-md border border-[#501122]/15 shadow-xl rounded-2xl p-2.5 px-3 flex items-center justify-between gap-2.5">

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#501122]/10 text-[#501122]">
                  {currentRouteOrder.order_number}
                </span>
                <Badge className={`${statusColors[currentRouteOrder.status] || 'bg-blue-100 text-blue-700'} rounded-full px-2 py-0.2 text-[9px] font-bold uppercase border-0`}>
                  {statusLabels[currentRouteOrder.status] || currentRouteOrder.status}
                </Badge>
              </div>
              <p className="font-heading text-sm font-bold text-[#501122] truncate mt-0.5">
                {currentRouteOrder.customer_name}
              </p>
              <p className="text-[11px] text-[#78686C] truncate flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0 text-[#4285F4]" />
                {currentRouteOrder.delivery_address || (currentRouteOrder.lat && currentRouteOrder.lng ? `${currentRouteOrder.lat.toFixed(4)}, ${currentRouteOrder.lng.toFixed(4)}` : 'Ubicación seleccionada')}
              </p>
            </div>

            {/* Top Right Action: GPS External & Exit "X" */}
            <div className="flex items-center gap-1.5 shrink-0">
              {buildMapsHref(currentRouteOrder) && (
                <a
                  href={buildMapsHref(currentRouteOrder)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-9 w-9 flex items-center justify-center rounded-xl bg-[#4285F4] hover:bg-[#3367D6] text-white active:scale-95 transition-all shadow-sm"
                  title="Abrir en Waze / Google Maps"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              <button
                type="button"
                onClick={() => setActiveRouteOrder(null)}
                data-testid="close-route-modal-btn"
                className="h-9 w-9 flex items-center justify-center rounded-xl bg-gray-100 hover:bg-gray-200 text-[#501122] active:scale-95 transition-all shadow-sm"
                title="Salir de la ruta"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Full Screen Navigation Map Area (extends behind top floating banner) */}
          <div className="absolute inset-0 z-10 w-full h-full">
            <DeliveryNavigationMap
              order={currentRouteOrder}
              centralPoint={settings.central_point_lat && settings.central_point_lng ? { lat: settings.central_point_lat, lng: settings.central_point_lng } : null}
              testId="route-modal-navigation-map"
            />
          </div>

          {/* Compact Bottom Overlay Area (Banners & Action Controls) */}
          <div className="mt-auto relative z-30 bg-white border-t border-[#501122]/15 shadow-[0_-8px_30px_rgba(80,17,34,0.15)] rounded-t-2xl overflow-hidden max-h-[50vh] [@media(orientation:landscape)_and_(max-height:500px)]:mt-0 [@media(orientation:landscape)_and_(max-height:500px)]:absolute [@media(orientation:landscape)_and_(max-height:500px)]:top-auto [@media(orientation:landscape)_and_(max-height:500px)]:left-2.5 [@media(orientation:landscape)_and_(max-height:500px)]:bottom-2.5 [@media(orientation:landscape)_and_(max-height:500px)]:w-[300px] [@media(orientation:landscape)_and_(max-height:500px)]:max-h-[calc(100vh-96px)] [@media(orientation:landscape)_and_(max-height:500px)]:rounded-2xl [@media(orientation:landscape)_and_(max-height:500px)]:border [@media(orientation:landscape)_and_(max-height:500px)]:shadow-xl flex flex-col justify-between">
            {/* Inner Padding Content Area */}
            <div className="p-2.5 px-3 space-y-2 overflow-y-auto">
              {/* Banner 1: Recibe otra persona */}
              {(currentRouteOrder.receiver_name || currentRouteOrder.receiver_phone) && (
                <div className="bg-[#501122]/5 border border-[#501122]/15 rounded-xl p-2 px-2.5 flex items-center justify-between gap-2" data-testid="route-modal-receiver-banner">
                  <div className="min-w-0">
                    <span className="text-[9px] font-extrabold uppercase tracking-wider text-[#501122] block">Recibe otra persona</span>
                    <p className="text-xs font-bold text-[#1F1517] truncate">
                      {currentRouteOrder.receiver_name || 'Sin nombre'} {currentRouteOrder.receiver_phone ? `(${currentRouteOrder.receiver_phone})` : ''}
                    </p>
                  </div>
                  {currentRouteOrder.receiver_phone && (
                    <button
                      type="button"
                      onClick={() => {
                        const rDigits = (currentRouteOrder.receiver_phone || '').replace(/[^0-9]/g, '');
                        const g = (currentRouteOrder.customer_gender || '').toUpperCase();
                        const treat = (g === 'F' || g === 'MUJER') ? ' querida' : ((g === 'M' || g === 'HOMBRE') ? ' hermano' : '');
                        const msg = `*Delivery de Lubo's Tiramisu*\nPedido de ${currentRouteOrder.customer_name || ''}\n\nHola${treat}, un gusto, es ${userName}. Ya voy saliendo para su ubicación para que estes pendiente🤎`;
                        window.open(`https://wa.me/${rDigits}?text=${encodeURIComponent(msg)}`, '_blank');
                      }}
                      className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#25D366] text-white text-[11px] font-bold active:scale-95 shadow-sm"
                    >
                      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                    </button>
                  )}
                </div>
              )}

              {/* Banner 2: Nota del vendedor */}
              {currentRouteOrder.notes && (
                <div className="bg-[#C27A29]/10 border border-[#C27A29]/25 rounded-xl p-2 px-2.5" data-testid="route-modal-notes-banner">
                  <span className="text-[9px] font-extrabold uppercase tracking-wider text-[#C27A29] block">Nota del vendedor</span>
                  <p className="text-xs font-medium text-[#1F1517] leading-tight mt-0.5">{currentRouteOrder.notes}</p>
                </div>
              )}

              {/* Avisar y Llamar split buttons */}
              <div className="flex w-full rounded-xl overflow-hidden divide-x divide-white/20 text-xs font-bold shadow-sm border border-[#501122]/10">
                {/* Button 1: Avisar (Ya llegué) */}
                <button
                  type="button"
                  onClick={() => {
                    const targetPhone = currentRouteOrder.receiver_phone || currentRouteOrder.customer_phone || '';
                    const digits = targetPhone.replace(/[^0-9]/g, '');
                    const msg = `Listo ya estoy acá🤎`;
                    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, '_blank');
                  }}
                  data-testid="route-modal-notify-arrived-btn"
                  className="flex-1 flex items-center justify-center gap-1.5 h-10 bg-[#25D366] hover:bg-[#20BF5B] text-white active:opacity-90 transition-all px-2"
                >
                  <MessageCircle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Avisar llegué</span>
                </button>

                {/* Button 2: Llamar */}
                <button
                  type="button"
                  onClick={() => {
                    const targetPhone = currentRouteOrder.receiver_phone || currentRouteOrder.customer_phone || '';
                    callCustomer(targetPhone);
                  }}
                  data-testid="route-modal-call-btn"
                  className="flex-1 flex items-center justify-center gap-1.5 h-10 bg-[#501122] hover:bg-[#3D0C19] text-white active:opacity-90 transition-all px-2"
                >
                  <Phone className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Llamar</span>
                </button>
              </div>
            </div>

            {/* Big "Entregado" Button - Full Width Bar Flush at Bottom */}
            <button
              type="button"
              onClick={async () => {
                await updateStatus(currentRouteOrder.id, 'entregado');
                setActiveRouteOrder(null);
              }}
              data-testid="route-modal-delivered-btn"
              className="w-full flex items-center justify-center gap-2 h-12 bg-[#3F634A] hover:bg-[#2E4A37] text-white text-sm font-extrabold uppercase tracking-wider active:opacity-90 transition-all shrink-0 border-t border-[#3F634A]"
            >
              <Check className="h-5 w-5 stroke-[3]" />
              <span>Entregado</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
