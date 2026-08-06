import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import api, { formatUSD, formatVES } from '@/lib/api';
import { useNotifications } from '@/hooks/useNotifications';
import usePushSubscription from '@/hooks/usePushSubscription';
import DeliveryMap from '@/components/DeliveryMap';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, MapPin, Check, Truck, Package, BarChart3, Undo2, DollarSign, CheckCircle2, Clock, Calendar, TrendingUp, Phone, ChevronDown, ChevronUp, ShoppingBag, Cake, Hourglass, LogOut, Volume2, VolumeX } from 'lucide-react';
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
  const [settings, setSettings] = useState({ exchange_rate_ves: 36.5 });
  const [deliveryStats, setDeliveryStats] = useState(null);
  const [dataPeriod, setDataPeriod] = useState('week');
  const { unreadCount } = useNotifications();
  const userName = user?.name || (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}').name || ''; } catch { return ''; }
  })();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const loadFast = useCallback(async () => {
    // Delivery: solo lo "vivo" (mis pedidos + disponibles + stats). Settings no cambia en polling.
    try {
      const [o, av] = await Promise.all([
        api.get('/orders'),
        api.get('/orders/available').catch(() => ({ data: [] })),
      ]);
      setOrders(o.data); setAvailableOrders(av.data);
    } catch (e) { console.warn('[Delivery] fast fetch failed:', e?.message || e); }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const { data } = await api.get('/settings');
      setSettings(data);
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

  // Comparte ubicacion cada 15s mientras el delivery este logueado.
  // Best-effort en background: cuando el navegador reanuda la pestana se envia
  // inmediatamente la ultima posicion conocida.
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    let lastSent = 0;
    let lastCoords = null;
    let watchId = null;
    const send = async (lat, lng) => {
      const now = Date.now();
      if (now - lastSent < 12000) return; // rate limit ~15s
      lastSent = now;
      try { await api.post('/delivery/location', { lat, lng }); }
      catch (e) { /* silencio, se reintenta en la siguiente muestra */ }
    };
    try {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          lastCoords = { lat: latitude, lng: longitude };
          send(latitude, longitude);
        },
        (err) => { console.warn('[Delivery] geolocation error:', err?.message || err); },
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
      );
    } catch (e) { console.warn('[Delivery] watchPosition failed:', e); }
    // Fuerza reenvio al volver a foreground.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && lastCoords) {
        lastSent = 0;
        send(lastCoords.lat, lastCoords.lng);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    // Fallback: si el navegador no dispara watchPosition, cada 15s intenta getCurrentPosition.
    const fallback = setInterval(() => {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            lastCoords = { lat: latitude, lng: longitude };
            send(latitude, longitude);
          },
          () => {},
          { enableHighAccuracy: false, maximumAge: 30000, timeout: 15000 },
        );
      } catch { /* ignore */ }
    }, 15000);
    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(fallback);
    };
  }, []);

  const updateStatus = async (orderId, status) => {
    try {
      await api.patch(`/orders/${orderId}/status`, { status });
      toast.success(status === 'entregado' ? 'Pedido entregado!' : status === 'pendiente' ? 'Pedido revertido' : 'En camino!');
      loadOrders();
      loadDeliveryStats();
    } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
  };

  const whatsappMessage = encodeURIComponent("Listo, ya estoy aca en la ubicacion");
  const rate = settings.exchange_rate_ves || 36.5;
  
  const safeOrders = Array.isArray(orders) ? orders : [];
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
    if (!window.confirm('Devolver este pedido a Disponibles? Otro repartidor podra tomarlo.')) return;
    try {
      await api.post(`/orders/${orderId}/unassign-delivery`);
      toast.success('Pedido devuelto a Disponibles');
      loadOrders();
    } catch (e) {
      toast.error(e?.response?.data?.detail || 'Error');
    }
  };

  const takeOrder = async (order) => {
    if (order.wait_for_notice) {
      toast.error('Este pedido tiene "esperar aviso" activo y no se puede tomar aún');
      return;
    }
    try {
      await api.post(`/orders/${order.id}/take`);
      toast.success('Pedido tomado. Toca "Salir a Entregar" para avisarle al cliente.');
      loadOrders();
    } catch (e) {
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
    <div className="space-y-5 pb-24 md:pb-6">
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
          {settings.exchange_rate_ves && (
            <div className="bg-[#3F634A]/10 border border-[#3F634A]/20 px-3 py-1.5 rounded-full text-[11px] font-bold text-[#3F634A]">
              BCV: {settings.exchange_rate_ves.toFixed(2)} Bs
            </div>
          )}
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

      {/* DISPONIBLES - simplified: name + location + take button */}
      {activeSection === 'disponibles' && (
        <div className="space-y-4">
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
          <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-4 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-1">Pedidos disponibles</p>
            <p className="text-[10px] text-[#78686C]">Toca &ldquo;Tomar pedido&rdquo; para asignartelo. Otros deliverys ya no lo veran.</p>
          </div>
          {availableOrders.length === 0 ? (
            <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-10 text-center" data-testid="no-available">
              <ShoppingBag className="h-10 w-10 text-[#78686C] mx-auto mb-3" />
              <p className="text-sm font-semibold text-[#501122]">No hay pedidos disponibles ahora</p>
              <p className="text-xs text-[#78686C] mt-1">Te aparecera aqui cuando llegue uno nuevo.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {sortedAvailableOrders.map(order => {
                const sched = getScheduleInfo(order);
                const isWaitForNotice = !!order.wait_for_notice;
                const locked = sched?.kind === 'future' || isWaitForNotice;
                const mapsHref = buildMapsHref(order);
                return (
                <div key={order.id}
                  className={`rounded-[1.5rem] border shadow-[0_8px_30px_rgba(80,17,34,0.03)] p-4 space-y-3 transition-all ${
                    locked 
                      ? 'bg-gray-100/90 border-gray-300/80 opacity-60 grayscale pointer-events-none select-none' 
                      : 'bg-white border-[#501122]/10'
                  }`}
                  data-testid={`available-${order.id}`}>
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
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <Button onClick={() => takeOrder(order)} disabled={locked} className="bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-2xl font-bold text-sm disabled:opacity-50 disabled:bg-gray-400" data-testid={`take-${order.id}`}>
                      {isWaitForNotice ? 'Esperando aviso...' : 'Tomar pedido'}
                    </Button>
                    <a href={mapsHref} target="_blank" rel="noopener noreferrer" data-testid={`av-maps-${order.id}`}
                      title="Ver ubicacion"
                      className="flex items-center justify-center h-12 w-12 rounded-2xl bg-[#4285F4] text-white active:scale-95 shrink-0">
                      <MapPin className="h-5 w-5" />
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
          {/* Bento Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-4 text-center shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
              <p className="font-heading text-3xl text-[#C27A29]">{todayStats.pending}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C] mt-1">Pendientes</p>
            </div>
            <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-4 text-center shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
              <p className="font-heading text-3xl text-[#3F634A]">{todayStats.delivered}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C] mt-1">Hoy</p>
            </div>
            <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-4 text-center shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
              <p className="font-heading text-2xl text-[#501122]">{formatUSD(todayStats.revenue)}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C] mt-1">Ganado</p>
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {sortedActiveOrders.map(order => {
                const isExpanded = expandedOrderId === order.id;
                const itemsSummary = order.items?.map(i => `${i.quantity}x ${i.flavor_name}`).join(', ') || '';
                const phoneDigits = (order.customer_phone || '').replace(/[^0-9]/g, '');
                const mapsHref = buildMapsHref(order);
                const sched = getScheduleInfo(order);
                const locked = sched?.kind === 'future';
                return (
                <div key={order.id} className={`bg-white rounded-[1.5rem] border border-[#501122]/10 shadow-[0_8px_30px_rgba(80,17,34,0.03)] overflow-hidden transition-all duration-300 hover:-translate-y-0.5 ${locked ? 'opacity-50 pointer-events-none' : ''}`} data-testid={`delivery-order-${order.id}`}>
                  {/* Header (toggles accordion) */}
                  <button type="button" onClick={() => setExpandedOrderId(isExpanded ? null : order.id)}
                    className="w-full p-4 flex justify-between items-center gap-3 text-left active:bg-[#F3EBE0]/40 transition-colors" data-testid={`accordion-toggle-${order.id}`}>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-mono text-[#78686C] block">{order.order_number}</span>
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
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {locked
                        ? <Badge className="bg-[#78686C] text-white rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border-0">Bloqueado</Badge>
                        : <Badge className={`${statusColors[order.status]} rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border-0`}>{statusLabels[order.status]}</Badge>}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-[#78686C]" /> : <ChevronDown className="h-4 w-4 text-[#78686C]" />}
                    </div>
                  </button>

                  {/* Meta chips siempre visibles (aunque el acordeon este cerrado):
                      notas, receptor alterno y velitas — mismo criterio que "Pedidos disponibles". */}
                  {(order.notes || order.receiver_name || order.receiver_phone || order.velitas) && (
                    <div className="px-4 pb-3 space-y-2" data-testid={`always-meta-${order.id}`}>
                      {order.notes && (
                        <div className="bg-[#C27A29]/10 border border-[#C27A29]/20 rounded-2xl px-3 py-2" data-testid={`mine-notes-${order.id}`}>
                          <p className="text-xs text-[#C27A29] leading-snug"><span className="font-bold">Nota:</span> {order.notes}</p>
                        </div>
                      )}
                      {(order.receiver_name || order.receiver_phone) && (
                        <div className="bg-[#501122]/5 border border-[#501122]/15 rounded-2xl px-3 py-2 flex items-center justify-between gap-2" data-testid={`mine-receiver-${order.id}`}>
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
                                const msg = `*Delivery de Lubo's Tiramisu*\nHola un gusto, es ${userName}. Te envian un tiramisu, asi que ya voy saliendo para su ubicacion.\npara que estes pendiente\uD83E\uDD0E`;
                                window.open(`https://wa.me/${rDigits}?text=${encodeURIComponent(msg)}`, '_blank');
                              }}
                              data-testid={`mine-receiver-wa-${order.id}`}
                              className="shrink-0 flex items-center gap-1 h-8 px-3 rounded-full bg-[#25D366] hover:bg-[#20BF5B] text-white text-[11px] font-semibold shadow-sm active:scale-95 transition-all"
                              title="Enviar WhatsApp al que recibe"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />WhatsApp
                            </button>
                          )}
                        </div>
                      )}
                      {order.velitas && (
                        <div className="bg-[#C27A29]/10 border border-[#C27A29]/20 rounded-2xl px-3 py-2 flex items-center gap-2" data-testid={`mine-velitas-${order.id}`}>
                          <Cake className="h-3.5 w-3.5 text-[#C27A29]" />
                          <p className="text-xs font-semibold text-[#C27A29]">Con velitas</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Expandable detail */}
                  {isExpanded && (
                    <div>
                      {/* Items (sin precios) */}
                      <div className="px-5 py-4 bg-[#F3EBE0]/40 border-t border-[#501122]/5">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-2">Productos a entregar</p>
                        <div className="space-y-1.5 text-sm">
                          {order.items?.map((it, i) => (
                            <div key={i} className="flex items-center gap-2 text-[#1F1517]">
                              <span className="font-medium">- {it.flavor_name}</span>
                              <span className="text-[#78686C]">x{it.quantity}</span>
                            </div>
                          ))}
                        </div>
                        {(order.delivery_fee || 0) > 0 && (
                          <div className="border-t border-[#501122]/10 mt-3 pt-3 flex justify-between items-center">
                            <span className="font-semibold text-[#501122] text-sm">Mi ganancia</span>
                            <div className="text-right">
                              <p className="font-heading text-lg text-[#3F634A]">{formatUSD(order.delivery_fee)}</p>
                              <p className="text-[10px] text-[#78686C]">{formatVES(order.delivery_fee, rate)}</p>
                            </div>
                          </div>
                        )}
                      </div>

                      {(order.delivery_address || (order.lat && order.lng)) && (
                        <div className="px-5 py-3 bg-[#4285F4]/5 border-t border-[#4285F4]/10" data-testid={`delivery-address-block-${order.id}`}>
                          <div className="flex items-start gap-2">
                            <MapPin className="h-4 w-4 text-[#4285F4] shrink-0 mt-0.5" />
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-0.5">Direccion</p>
                              <p className="text-xs text-[#1F1517] break-all" data-testid={`delivery-address-text-${order.id}`}>
                                {order.lat && order.lng
                                  ? `${order.lat.toFixed(5)}, ${order.lng.toFixed(5)}`
                                  : order.delivery_address}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* notes / receiver / velitas se muestran siempre arriba del acordeon */}

                      {(order.status === 'pendiente' || order.status === 'en_camino') && (
                        <div className="px-5 py-3 border-t border-[#501122]/5">
                          <button type="button" onClick={() => releaseOrder(order.id)} data-testid={`release-btn-${order.id}`}
                            className="w-full flex items-center justify-center gap-2 h-10 rounded-2xl bg-[#C27A29]/10 hover:bg-[#C27A29]/20 text-[#C27A29] text-xs font-semibold active:scale-95 transition-all">
                            <Undo2 className="h-3.5 w-3.5" />Devolver a Disponibles
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Buttons - single row */}
                  <div className="p-3 border-t border-[#501122]/5 flex items-center gap-2">
                    {order.status === 'pendiente' && (
                      <Button onClick={() => {
                        updateStatus(order.id, 'en_camino');
                        const g = order.customer_gender;
                        const treat = g === 'F' ? ' querida' : (g === 'M' ? ' hermano' : '');
                        const msg = `*Delivery de Lubo's Tiramisu*\nPedido de ${order.customer_name}\n\nHola${treat}, un gusto, es ${userName}. Ya voy saliendo para su ubicacion.`;
                        window.open(`https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`, '_blank');
                      }}
                        className="flex-1 bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-2xl text-sm font-semibold active:scale-95 shadow-md"
                        data-testid={`start-delivery-btn-${order.id}`}>
                        <Truck className="h-4 w-4 mr-1.5" />Empezar
                      </Button>
                    )}
                    {order.status === 'en_camino' && (
                      <Button onClick={() => updateStatus(order.id, 'entregado')}
                        className="flex-1 bg-[#3F634A] hover:bg-[#2E4A37] text-white h-12 rounded-2xl text-sm font-semibold active:scale-95 shadow-md"
                        data-testid={`deliver-btn-${order.id}`}>
                        <Check className="h-4 w-4 mr-1.5" />Entregado
                      </Button>
                    )}
                    <a href={`https://wa.me/${phoneDigits}?text=${whatsappMessage}`}
                      target="_blank" rel="noopener noreferrer" data-testid={`whatsapp-btn-${order.id}`}
                      title="WhatsApp"
                      className="flex items-center justify-center h-12 w-12 rounded-2xl bg-[#25D366] text-white active:scale-95 shrink-0">
                      <MessageCircle className="h-5 w-5" />
                    </a>
                    <button type="button" onClick={() => callCustomer(order.customer_phone)} data-testid={`call-btn-${order.id}`}
                      title="Llamar"
                      className="flex items-center justify-center h-12 w-12 rounded-2xl bg-[#501122] text-white active:scale-95 shrink-0">
                      <Phone className="h-5 w-5" />
                    </button>
                    <a href={mapsHref} target="_blank" rel="noopener noreferrer" data-testid={`maps-btn-${order.id}`}
                      title="Ver ruta"
                      className="flex items-center justify-center h-12 w-12 rounded-2xl bg-[#4285F4] text-white active:scale-95 shrink-0">
                      <MapPin className="h-5 w-5" />
                    </a>
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

      {/* Mobile Bottom Nav - Floating Pill */}
      <div className="fixed bottom-4 left-4 right-4 md:hidden bg-white/90 backdrop-blur-xl border border-[#501122]/10 shadow-xl rounded-[2rem] flex justify-around p-2 z-50">
        {navItems.map(n => (
          <button key={n.id} onClick={() => setActiveSection(n.id)} data-testid={`mobile-tab-${n.id}`}
            className={`relative flex flex-col items-center gap-1 py-2 px-8 rounded-2xl transition-all duration-300 ${activeSection === n.id ? 'text-[#501122] bg-[#501122]/5' : 'text-[#78686C]'}`}>
            <n.icon className={`h-5 w-5 ${activeSection === n.id ? 'stroke-[2.5px]' : ''}`} />
            <span className="text-[10px] font-semibold">{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
