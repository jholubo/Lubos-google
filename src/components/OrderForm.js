import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'sonner';
import api, { formatUSD, formatVES } from '@/lib/api';
import { getLocalCache, setLocalCache } from '@/lib/cache';
import { notifyLocalChange } from '@/lib/dataSync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useBackButtonClose } from '@/hooks/useBackButtonClose';
import { playNotificationSound } from '@/hooks/useNotifications';
import { ShoppingBag, Phone, Minus, Plus, Check, ChevronsUpDown, ChevronDown, Truck, Store, Link2, MapPin, FileText, CalendarClock, Copy, Cake, UserRoundPlus, Hourglass, X } from 'lucide-react';
import { MapBody } from './DeliveryMap';
import { SafeMapsLoader } from '@/lib/mapsLoader';
import { getStoredCentralPoint, saveCentralPointCoords, syncCentralPointWithBackend } from '@/lib/centralPoint';

const parseCoordsLocal = (url) => {
  if (!url) return null;
  // Priority 1: !3d!4d = actual pin (most accurate on long Google Maps links)
  const m3 = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m3) return { lat: parseFloat(m3[1]), lng: parseFloat(m3[2]) };
  // Priority 2: ?q=lat,lng = explicit shared pin
  const m1 = url.match(/[?&]q=(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/i);
  if (m1) return { lat: parseFloat(m1[1]), lng: parseFloat(m1[2]) };
  // Priority 3: @lat,lng = camera center (fallback; can be off by ~300m from pin)
  const m2 = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m2) return { lat: parseFloat(m2[1]), lng: parseFloat(m2[2]) };
  return null;
};

function AddressMiniMapInner({ isLoaded, addressUrl, detectedZone, centralPoint, manualCoords, onManualPinChange, waitForNotice }) {
  const [routeStatus, setRouteStatus] = useState(null); // 'route' | 'fallback' | null
  // Priority: manual override > backend (handles FB redirects) > local parse
  const backendCoords = (typeof detectedZone?.lat === 'number' && typeof detectedZone?.lng === 'number')
    ? { lat: detectedZone.lat, lng: detectedZone.lng }
    : null;
  const localCoords = parseCoordsLocal(addressUrl);
  const point = manualCoords || backendCoords || localCoords;
  const fakeOrder = point ? [{
    id: '__preview__',
    lat: point.lat, lng: point.lng,
    status: 'pendiente',
    customer_name: 'Cliente',
    order_number: '',
    order_type: 'delivery',
    scheduled_for: null,
    wait_for_notice: waitForNotice,
  }] : [];
  // Zoom in when we have a point (via centerRequestId trick: fresh id every time point changes)
  const centerId = point ? Math.floor(point.lat * 10000) + Math.floor(point.lng * 10000) : 0;
  return (
    <div className="rounded-2xl overflow-hidden border border-[#501122]/10 bg-[#F3EBE0]/30 h-[220px] md:h-[280px] relative">
      {!isLoaded ? (
        <div className="flex items-center justify-center h-full"><MapPin className="h-6 w-6 text-[#501122]/30" /></div>
      ) : point ? (
        <>
          <MapBody
            orders={fakeOrder}
            height="100%"
            centralPoint={centralPoint || point}
            centerRequestId={centerId}
            defaultZoom={15}
            hideCentralPin={!centralPoint}
            draggablePinId="__preview__"
            onPinDragEnd={(_id, lat, lng) => onManualPinChange && onManualPinChange({ lat, lng })}
            showRoute={!!centralPoint}
            onRouteStatus={setRouteStatus}
          />
          <div className="pointer-events-none absolute top-1.5 left-1.5 z-10 px-2.5 py-1 rounded-full bg-white/95 border border-[#501122]/15 shadow-sm text-[10px] font-bold text-[#501122] flex items-center gap-1.5">
            <MapPin className="h-3 w-3 text-[#C27A29]" />
            <span>Arrastra el pin para ajustar la ubicación</span>
          </div>

          {detectedZone?.distance_km !== undefined && (
            <div className="pointer-events-none absolute bottom-1.5 left-1.5 z-10 px-2.5 py-1 rounded-full bg-[#501122] text-white shadow-md text-[10px] font-bold flex items-center gap-1.5">
              <span>Distancia: {detectedZone.distance_km} km</span>
              {typeof detectedZone?.delivery_cost_usd === 'number' && (
                <span className="bg-[#C27A29] text-white px-1.5 py-0.5 rounded-md font-extrabold text-[9px]">
                  ${detectedZone.delivery_cost_usd.toFixed(2)}
                </span>
              )}
            </div>
          )}

          {manualCoords && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onManualPinChange && onManualPinChange(null); }}
              className="absolute top-1.5 right-1.5 z-10 px-2.5 py-1 rounded-full bg-[#501122] hover:bg-[#3F0D1B] text-white text-[10px] font-bold uppercase tracking-wider shadow-md transition-colors"
              data-testid="order-form-reset-pin"
              title="Volver al pin del link"
            >
              Restablecer pin
            </button>
          )}

          {point && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                saveCentralPointCoords(point.lat, point.lng, addressUrl);
                toast.success('Ubicación de la tienda guardada permanentemente');
              }}
              className="absolute bottom-1.5 right-1.5 z-10 px-2.5 py-1 rounded-full bg-[#3F634A] hover:bg-[#2F4B38] text-white text-[10px] font-bold shadow-md transition-colors flex items-center gap-1"
              title="Guardar esta posición como la ubicación fija de la tienda"
            >
              <Store className="h-3 w-3" />
              <span>Guardar como Tienda</span>
            </button>
          )}
        </>
      ) : centralPoint ? (
        <MapBody orders={[]} height="100%" centralPoint={centralPoint} defaultZoom={12} hideCentralPin={true} />
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-1 p-3 text-center">
          <MapPin className="h-6 w-6 text-[#501122]/30" />
          <p className="text-[10px] text-[#78686C]">Pega el link de Google Maps para ver la ruta desde la tienda</p>
        </div>
      )}
    </div>
  );
}

export function AddressMiniMap(props) {
  return (
    <SafeMapsLoader>
      {({ isLoaded }) => (
        <AddressMiniMapInner isLoaded={isLoaded} {...props} />
      )}
    </SafeMapsLoader>
  );
}

function normalizeCustomers(data) {
  if (Array.isArray(data)) return data.filter(Boolean);
  if (data && Array.isArray(data.customers)) return data.customers.filter(Boolean);
  return [];
}

export default function OrderForm({ onSuccess, initialQuote, onCancelQuote, initialCustomer }) {
  const [customers, setCustomers] = useState([]);
  const [flavors, setFlavors] = useState([]);
  const [deliveryUsers, setDeliveryUsers] = useState([]);
  const [bcvRate, setBcvRate] = useState(36.5);
  const [centralPoint, setCentralPoint] = useState(() => getStoredCentralPoint());

  const [customerOpen, setCustomerOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCustomerObj, setSelectedCustomerObj] = useState(null);
  const selectedCustomerIdRef = useRef(selectedCustomerId);
  useEffect(() => { selectedCustomerIdRef.current = selectedCustomerId; }, [selectedCustomerId]);

  const [orderItems, setOrderItems] = useState({});
  const [orderType, setOrderType] = useState('delivery');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [selectedDelivery, setSelectedDelivery] = useState('');
  const [deliveryFee, setDeliveryFee] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [detectedZone, setDetectedZone] = useState(null);
  const [manualCoords, setManualCoords] = useState(null); // { lat, lng } — user-adjusted pin
  const [zoneCheckLoading, setZoneCheckLoading] = useState(false);
  const [feeManuallyEdited, setFeeManuallyEdited] = useState(false);
  const [outOfZoneOverride, setOutOfZoneOverride] = useState(false);
  const [distanceMode, setDistanceMode] = useState('route'); // 'route' or 'linear'
  const [isQuote, setIsQuote] = useState(true); // cotizacion ficticia (sin cliente) — activada por defecto
  const [quoteDescription, setQuoteDescription] = useState(''); // label to identify the quote
  const [scheduleMode, setScheduleMode] = useState('queue'); // 'queue' or 'scheduled'
  const [scheduledFor, setScheduledFor] = useState(''); // datetime-local string
  const [waitForNotice, setWaitForNotice] = useState(false);
  const [velitas, setVelitas] = useState(false);
  const [receiverEnabled, setReceiverEnabled] = useState(false);
  const [receiverName, setReceiverName] = useState('');
  const [receiverPhonePrefix, setReceiverPhonePrefix] = useState('+58');
  const [receiverPhoneLocal, setReceiverPhoneLocal] = useState('');

  // Inline create-customer
  const [showCustomerDialog, setShowCustomerDialog] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPrefix, setNewCustPrefix] = useState('+58');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustGender, setNewCustGender] = useState(null);

  useBackButtonClose(customerOpen, () => setCustomerOpen(false));
  useBackButtonClose(showCustomerDialog, () => setShowCustomerDialog(false));

  // Cliente: busqueda del lado del servidor con debounce (25 iniciales, refetch por q).
  const [customerSearch, setCustomerSearch] = useState('');

  const loadData = useCallback(async () => {
    // Instant cache population (0ms render time)
    const cFlavors = getLocalCache('flavors');
    if (cFlavors) setFlavors(cFlavors.filter(x => x.available));
    const cCust = getLocalCache('customers');
    if (cCust) setCustomers(normalizeCustomers(cCust));
    const cUsers = getLocalCache('users');
    if (cUsers) setDeliveryUsers(cUsers.filter(x => x.role === 'delivery'));
    const cSettings = getLocalCache('settings');
    if (cSettings?.exchange_rate_ves) setBcvRate(cSettings.exchange_rate_ves);
    const storedCp = getStoredCentralPoint();
    if (storedCp) setCentralPoint(storedCp);

    try {
      const [c, f, u, s] = await Promise.all([
        api.get('/customers', { params: { limit: 25 } }),
        api.get('/flavors'),
        api.get('/users'),
        api.get('/settings'),
      ]);
      const cList = normalizeCustomers(c.data);
      setCustomers(prev => {
        const curSelId = selectedCustomerIdRef.current;
        const prevList = normalizeCustomers(prev);
        const sel = prevList.find(x => x.id === curSelId);
        if (sel && !cList.some(x => x.id === sel.id)) {
          return [sel, ...cList];
        }
        return cList;
      });
      setLocalCache('customers', cList);
      setFlavors(f.data.filter(x => x.available));
      setLocalCache('flavors', f.data);
      setDeliveryUsers(u.data.filter(x => x.role === 'delivery'));
      setLocalCache('users', u.data);
      if (s.data?.exchange_rate_ves) setBcvRate(s.data.exchange_rate_ves);
      setLocalCache('settings', s.data);
      syncCentralPointWithBackend(s.data);
      const activeCp = getStoredCentralPoint();
      if (activeCp) setCentralPoint(activeCp);
    } catch (e) { console.warn('[OrderForm] data load failed:', e?.message || e); }
  }, []);

  useEffect(() => {
    loadData();
    const onCustSync = () => loadData();
    const onFlavSync = () => loadData();
    const onSetSync = () => {
      loadData();
      setCentralPoint(getStoredCentralPoint());
    };
    window.addEventListener('lubos:customers-changed', onCustSync);
    window.addEventListener('lubos:flavors-changed', onFlavSync);
    window.addEventListener('lubos:settings-changed', onSetSync);
    return () => {
      window.removeEventListener('lubos:customers-changed', onCustSync);
      window.removeEventListener('lubos:flavors-changed', onFlavSync);
      window.removeEventListener('lubos:settings-changed', onSetSync);
    };
  }, [loadData]);

  // Debounced customer search: refetch server-side when user types
  useEffect(() => {
    const term = (customerSearch || '').trim();
    // Si el popover no esta abierto, no gastes red
    if (!customerOpen) return;
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/customers', {
          params: term ? { q: term, limit: 50 } : { limit: 25 },
        });
        const cList = normalizeCustomers(data);
        setCustomers(prev => {
          const prevList = normalizeCustomers(prev);
          const sel = prevList.find(c => c.id === selectedCustomerId);
          if (sel && !cList.some(c => c.id === sel.id)) return [sel, ...cList];
          return cList;
        });
      } catch (e) { console.warn('[OrderForm] customer search failed:', e?.message || e); }
    }, 250);
    return () => clearTimeout(t);
  }, [customerSearch, customerOpen, selectedCustomerId]);

  // Pre-load form when "retomando" a quote
  useEffect(() => {
    if (!initialQuote) return;
    const items = {};
    (initialQuote.items || []).forEach(it => {
      items[it.flavor_id] = { id: it.flavor_id, name: it.flavor_name, price_usd: it.price_usd, quantity: it.quantity };
    });
    setOrderItems(items);
    setOrderType(initialQuote.order_type || 'delivery');
    setDeliveryAddress(initialQuote.delivery_address || '');
    setDeliveryFee(initialQuote.delivery_fee ? String(initialQuote.delivery_fee) : '');
    setOrderNotes(initialQuote.notes || '');
    if (initialQuote.scheduled_for) {
      setScheduleMode('scheduled');
      // strip the 'Z' and seconds for datetime-local
      try { setScheduledFor(new Date(initialQuote.scheduled_for).toISOString().slice(0, 16)); }
      catch { setScheduledFor(''); }
    }
    if (initialQuote.wait_for_notice) setWaitForNotice(true);
    setIsQuote(!!initialQuote.is_quote);
    setQuoteDescription(initialQuote.quote_description || '');
    setSelectedCustomerId(initialQuote.customer_id || '');
    setVelitas(!!initialQuote.velitas);
    if (initialQuote.receiver_name || initialQuote.receiver_phone) {
      setReceiverEnabled(true);
      setReceiverName(initialQuote.receiver_name || '');
      const rp = initialQuote.receiver_phone || '';
      if (rp.startsWith('+')) {
        // split "+58" prefix vs the rest
        const m = rp.match(/^(\+\d{1,3})(.*)$/);
        if (m) { setReceiverPhonePrefix(m[1]); setReceiverPhoneLocal(m[2]); }
        else { setReceiverPhoneLocal(rp); }
      } else { setReceiverPhoneLocal(rp); }
    }
  }, [initialQuote]);

  // Pre-select customer if initialCustomer prop is provided
  useEffect(() => {
    if (initialCustomer && initialCustomer.id) {
      setSelectedCustomerId(initialCustomer.id);
      setSelectedCustomerObj(initialCustomer);
      setIsQuote(false);
    }
  }, [initialCustomer]);

  // Auto-detect zone (uses manualCoords override if user dragged the pin)
  useEffect(() => {
    if (orderType !== 'delivery') {
      setDetectedZone(null);
      return;
    }
    if (!deliveryAddress && !manualCoords) {
      setDetectedZone(null);
      return;
    }
    const timer = setTimeout(async () => {
      setZoneCheckLoading(true);
      try {
        const payload = manualCoords
          ? { lat: manualCoords.lat, lng: manualCoords.lng, mode: distanceMode }
          : { url: deliveryAddress, mode: distanceMode };
        const { data } = await api.post('/zones/check', payload);
        setDetectedZone({
          matched: data.matched, reason: data.reason,
          name: data.zone?.name, color: data.zone?.color,
          distance_km: data.distance_km, delivery_cost_usd: data.delivery_cost_usd,
          distance_source: data.distance_source,
          route_failed: data.route_failed,
          linear_distance_km: data.linear_distance_km,
          linear_cost_usd: data.linear_cost_usd,
          lat: data.lat, lng: data.lng,
        });
        if (data.delivery_cost_usd !== undefined && !feeManuallyEdited) {
          setDeliveryFee(String(data.delivery_cost_usd));
        }
      } catch { setDetectedZone(null); }
      setZoneCheckLoading(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [deliveryAddress, orderType, distanceMode, manualCoords]);

  // If user pastes a new URL, discard any prior manual pin adjustment
  useEffect(() => { setManualCoords(null); }, [deliveryAddress]);

  const addFlavor = (f) => {
    setOrderItems(prev => {
      const existing = prev[f.id];
      const nextQty = (existing?.quantity || 0) + 1;
      if (!f.stock_unlimited && nextQty > (f.stock || 0)) { toast.error(`Solo hay ${f.stock} disponibles`); return prev; }
      return { ...prev, [f.id]: { id: f.id, name: f.name, price_usd: f.price_usd, quantity: nextQty } };
    });
  };
  const removeFlavor = (id) => {
    setOrderItems(prev => {
      const existing = prev[id];
      if (!existing) return prev;
      const nextQty = existing.quantity - 1;
      if (nextQty <= 0) { const { [id]: _, ...rest } = prev; return rest; }
      return { ...prev, [id]: { ...existing, quantity: nextQty } };
    });
  };

  const saveNewCustomer = async () => {
    if (!newCustName || !newCustPhone) { toast.error('Completa nombre y telefono'); return; }

    const fullPhone = `${newCustPrefix}${newCustPhone}`;
    const tempId = `temp_${Date.now()}`;
    const name = newCustName.trim();
    const gender = newCustGender;

    const tempCustomer = {
      id: tempId,
      name,
      phone: fullPhone,
      gender,
      total_orders: 0,
      total_spent: 0,
      created_at: new Date().toISOString(),
    };

    // 1. INSTANT (0ms): Update local state, select customer, uncheck quote, close dialog
    setCustomers(prev => [tempCustomer, ...normalizeCustomers(prev).filter(c => String(c.id) !== String(tempId))]);
    setSelectedCustomerId(tempId);
    setSelectedCustomerObj(tempCustomer);
    setIsQuote(false);
    setShowCustomerDialog(false);
    setNewCustName('');
    setNewCustPhone('');
    setNewCustGender(null);
    toast.success('Cliente creado');

    // 2. Async persistence in background
    try {
      const { data } = await api.post('/customers', { name, phone: fullPhone, gender });
      
      // Replace tempId with real DB object in customers array & selectedCustomerId
      if (data && data.id) {
        setCustomers(prev => {
          const list = normalizeCustomers(prev);
          const filtered = list.filter(c => String(c.id) !== String(tempId) && String(c.id) !== String(data.id));
          const updated = [data, ...filtered];
          setLocalCache('customers', updated);
          return updated;
        });

        setSelectedCustomerId(prevId => (String(prevId) === String(tempId) ? data.id : prevId));
        setSelectedCustomerObj(data);
        notifyLocalChange('customers_changed', { self: true });
      }
    } catch (err) {
      console.error('[saveNewCustomer] Error:', err);
      // Handle existing customer (409)
      if (err.response?.status === 409) {
        try {
          const { data: searchRes } = await api.get('/customers', { params: { q: fullPhone } });
          const foundList = normalizeCustomers(searchRes);
          const existing = foundList.find(c => c.phone && c.phone.replace(/[^0-9]/g, '') === fullPhone.replace(/[^0-9]/g, ''));
          if (existing) {
            setCustomers(prev => {
              const list = normalizeCustomers(prev).filter(c => String(c.id) !== String(tempId));
              return [existing, ...list.filter(c => String(c.id) !== String(existing.id))];
            });
            setSelectedCustomerId(existing.id);
            setSelectedCustomerObj(existing);
            setIsQuote(false);
            toast.info(`Cliente existente seleccionado: ${existing.name}`);
            return;
          }
        } catch (e) {
          console.warn('Failed to search existing customer:', e);
        }
      }
      // Rollback if request fails
      setCustomers(prev => normalizeCustomers(prev).filter(c => String(c.id) !== String(tempId)));
      setSelectedCustomerId(prevId => (String(prevId) === String(tempId) ? '' : prevId));
      setSelectedCustomerObj(null);
      toast.error(err.response?.data?.detail || 'Error al guardar cliente');
    }
  };

  const effectiveIsQuote = orderType === 'tienda' ? false : isQuote;

  const submitOrder = async () => {
    if (!effectiveIsQuote && orderType !== 'tienda' && !selectedCustomerId) { toast.error('Selecciona un cliente o marca como cotizacion'); return; }
    const items = Object.values(orderItems).filter(i => i.quantity > 0);
    if (items.length === 0) { toast.error('Agrega al menos un sabor'); return; }
    if (scheduleMode === 'scheduled' && !scheduledFor) { toast.error('Indica fecha y hora programada'); return; }
    let scheduled_iso = null;
    if (scheduleMode === 'scheduled' && scheduledFor) {
      try {
        const d = new Date(scheduledFor);
        if (!isNaN(d.getTime())) {
          scheduled_iso = d.toISOString();
        } else {
          toast.error('Fecha programada inválida');
          return;
        }
      } catch {
        toast.error('Fecha programada inválida');
        return;
      }
    }

    const payload = {
      customer_id: orderType === 'tienda' ? null : (selectedCustomerId || null),
      items: items.map(i => ({ flavor_id: i.id, flavor_name: i.name, quantity: i.quantity, price_usd: i.price_usd })),
      order_type: orderType,
      delivery_address: orderType === 'delivery' ? deliveryAddress : '',
      delivery_id: null,
      delivery_fee: orderType === 'delivery' ? parseFloat(deliveryFee || 0) : 0,
      notes: orderNotes,
      is_quote: effectiveIsQuote,
      quote_description: effectiveIsQuote
        ? (quoteDescription || '').trim()
        : (initialQuote ? (initialQuote.quote_description || 'Cotización retomada').trim() : null),
      scheduled_for: scheduled_iso,
      wait_for_notice: waitForNotice,
      // Manual pin override: only send when user dragged the pin on the mini-map
      lat: orderType === 'delivery' && manualCoords ? manualCoords.lat : null,
      lng: orderType === 'delivery' && manualCoords ? manualCoords.lng : null,
      velitas: velitas,
      receiver_name: receiverEnabled ? (receiverName || '').trim() || null : null,
      receiver_phone: receiverEnabled && receiverPhoneLocal
        ? `${receiverPhonePrefix}${(receiverPhoneLocal || '').replace(/[^0-9]/g, '')}`
        : null,
    };

    const quoteToDeleteId = initialQuote ? initialQuote.id : null;
    const wasQuote = effectiveIsQuote;
    const wasInitialQuote = !!initialQuote;
    const currentOrderType = orderType;

    const selectedCustomer = normalizeCustomers(customers).find(c => c && c.id === selectedCustomerId);
    const tempId = `temp_${Date.now()}`;
    const itemsTotal = items.reduce((sum, i) => sum + i.quantity * i.price_usd, 0);
    const fee = currentOrderType === 'delivery' ? parseFloat(deliveryFee || 0) : 0;

    const optimisticItem = {
      id: tempId,
      order_number: wasQuote ? 'COT-NUEVA' : 'PED-NUEVO',
      customer_id: selectedCustomerId || null,
      customer_name: selectedCustomer ? selectedCustomer.name : (currentOrderType === 'tienda' ? 'Venta en Tienda' : '(Cotización sin cliente)'),
      customer_phone: selectedCustomer ? selectedCustomer.phone : (currentOrderType === 'tienda' ? 'N/A' : ''),
      customer_gender: selectedCustomer ? selectedCustomer.gender : null,
      items: items.map((it, idx) => ({
        id: `item_${tempId}_${idx}`,
        flavor_id: it.id,
        flavor_name: it.name,
        quantity: it.quantity,
        price_usd: it.price_usd
      })),
      order_type: currentOrderType,
      delivery_address: currentOrderType === 'delivery' ? deliveryAddress : '',
      lat: currentOrderType === 'delivery' && manualCoords ? manualCoords.lat : null,
      lng: currentOrderType === 'delivery' && manualCoords ? manualCoords.lng : null,
      delivery_id: null,
      delivery_name: currentOrderType === 'pickup' ? 'Pickup en tienda' : (currentOrderType === 'tienda' ? 'Venta en tienda' : null),
      delivery_fee: fee,
      status: wasQuote ? 'cotizacion' : (currentOrderType === 'tienda' ? 'entregado' : 'pendiente'),
      is_quote: wasQuote,
      quote_description: wasQuote ? (quoteDescription || '').trim() : null,
      scheduled_for: scheduled_iso,
      wait_for_notice: waitForNotice,
      total_usd: itemsTotal + fee,
      items_total: itemsTotal,
      notes: orderNotes,
      velitas: velitas,
      receiver_name: receiverEnabled ? (receiverName || '').trim() || null : null,
      receiver_phone: receiverEnabled && receiverPhoneLocal ? `${receiverPhonePrefix}${(receiverPhoneLocal || '').replace(/[^0-9]/g, '')}` : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 1. INSTANT (0ms) FEEDBACK: Sound, Toast, Reset & Optimistic UI Insertion
    if (!wasQuote) {
      try { playNotificationSound('new_sale'); } catch { /* ignore */ }
    }
    toast.success(
      wasQuote ? (wasInitialQuote ? 'Cotización actualizada' : 'Cotización guardada') :
      wasInitialQuote ? 'Cotización convertida en pedido' :
      (currentOrderType === 'tienda' ? 'Venta en tienda creada y entregada' :
       currentOrderType === 'pickup' ? 'Pedido (pickup) creado' : 'Pedido creado')
    );

    // Reset panel inputs instantly
    setSelectedCustomerId(''); setSelectedCustomerObj(null); setOrderItems({}); setDeliveryAddress('');
    setSelectedDelivery(''); setDeliveryFee(''); setOrderNotes('');
    setDetectedZone(null); setFeeManuallyEdited(false); setOutOfZoneOverride(false);
    setManualCoords(null); setWaitForNotice(false);
    setVelitas(false); setReceiverEnabled(false); setReceiverName(''); setReceiverPhoneLocal('');
    setOrderType('delivery'); setIsQuote(true); setQuoteDescription('');
    setScheduleMode('queue'); setScheduledFor('');

    // Instant callback to parent with optimistic item (inserts into list at 0ms!)
    if (onSuccess) onSuccess(optimisticItem, quoteToDeleteId);

    // 2. BACKGROUND SERVER CREATION
    (async () => {
      try {
        const res = await api.post('/orders', payload);
        const createdOrder = res.data;
        if (quoteToDeleteId) {
          try { await api.delete(`/quotes/${quoteToDeleteId}`); }
          catch (e) { console.warn('No se pudo eliminar la cotizacion original:', e?.message || e); }
        }
        if (onSuccess) onSuccess(createdOrder, quoteToDeleteId);
        notifyLocalChange('orders_changed');
        loadData();
      } catch (err) {
        console.error('Error al guardar el pedido en el servidor:', err);
        toast.error(err.response?.data?.detail || 'Error al procesar el pedido en el servidor');
      }
    })();
  };

  const hasItems = Object.keys(orderItems).length > 0;
  const itemsTotal = Object.values(orderItems).reduce((sum, i) => sum + i.quantity * i.price_usd, 0);
  const totalUSD = itemsTotal + (orderType === 'pickup' ? 0 : parseFloat(deliveryFee || 0));
  const selectedCustomer = selectedCustomerId
    ? (normalizeCustomers(customers).find(c => c && String(c.id) === String(selectedCustomerId)) || (selectedCustomerObj && String(selectedCustomerObj.id) === String(selectedCustomerId) ? selectedCustomerObj : null))
    : null;

  return (
    <div className="lg:pr-[360px] relative">
      {/* RIGHT: fixed to the viewport at lg+ so it never scrolls away */}
      <aside
        className="lg:fixed lg:right-4 lg:top-4 lg:w-[340px] lg:h-[calc(100vh-2rem)] lg:overflow-y-auto lg:z-30 space-y-4 mt-6 lg:mt-0"
        data-testid="of-summary-panel"
      >
        {/* Customer / quote header + items (top of column) */}
        <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#78686C]">Pedido</p>
          <p className="font-heading text-xl text-[#501122] mt-0.5 truncate" data-testid="of-preview-customer">
            {selectedCustomer ? selectedCustomer.name : (isQuote ? (quoteDescription || 'Cotizacion nueva') : 'Sin cliente')}
          </p>
          {/* Compact items list */}
          {hasItems && (
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.values(orderItems).filter(i => i.quantity > 0).map(it => (
                <div key={it.id} className="flex items-center gap-2 bg-[#F3EBE0] rounded-full pl-1 pr-3 py-1" data-testid={`of-preview-item-${it.id}`}>
                  <div className="w-6 h-6 rounded-full bg-[#501122] flex items-center justify-center text-white text-[10px] font-bold shrink-0">{it.quantity}</div>
                  <span className="text-xs font-semibold text-[#501122] truncate max-w-[140px]">{it.name}</span>
                </div>
              ))}
            </div>
          )}
          {(velitas || (receiverEnabled && (receiverName || receiverPhoneLocal))) && (
            <div className="mt-3 flex flex-wrap gap-2">
              {velitas && (
                <span className="inline-flex items-center gap-1 h-7 px-3 rounded-full bg-[#C27A29]/10 text-[#C27A29] text-[10px] font-bold uppercase tracking-wider">
                  <Cake className="h-3 w-3" />Velitas
                </span>
              )}
              {receiverEnabled && (receiverName || receiverPhoneLocal) && (
                <span className="inline-flex items-center gap-1 h-7 px-3 rounded-full bg-[#501122]/10 text-[#501122] text-[10px] font-bold uppercase tracking-wider">
                  <UserRoundPlus className="h-3 w-3" />Recibe {receiverPhoneLocal || receiverName}
                </span>
              )}
            </div>
          )}
        </div>

        {/* PIN TO BOTTOM: map + summary + submit */}
        <div className="space-y-3">
          {orderType === 'delivery' && (
            <div data-testid="of-summary-map-wrap">
              <AddressMiniMap
                addressUrl={deliveryAddress}
                detectedZone={detectedZone}
                centralPoint={centralPoint}
                manualCoords={manualCoords}
                onManualPinChange={setManualCoords}
                waitForNotice={waitForNotice}
              />
            </div>
          )}
          {hasItems && (
          <div className="bg-gradient-to-br from-[#F3EBE0] to-[#F0E4D8] rounded-[1.5rem] border-2 border-[#501122]/15 p-4 shadow-[0_8px_30px_rgba(80,17,34,0.06)]">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#78686C]">Resumen del pedido</p>
              <button type="button" onClick={async () => {
                const fee = orderType === 'delivery' ? parseFloat(deliveryFee || 0) : 0;
                const parts = [];
                if (fee > 0) parts.push(`El delivery seria ${formatUSD(fee)}`);
                parts.push(`de tiramisu seria ${formatUSD(itemsTotal)}`);
                parts.push(`para un total de ${formatUSD(totalUSD)}`);
                const line1 = parts.join(', ') + '.';
                const msg = `${line1}\n\nEn bolivares ${formatVES(totalUSD, bcvRate)}`;
                try { await navigator.clipboard.writeText(msg); toast.success('Mensaje copiado'); } catch { toast.error('No se pudo copiar'); }
              }} data-testid="of-copy-summary" title="Copiar mensaje de precios"
                className="flex items-center gap-1 h-6 px-2 rounded-full bg-[#501122]/10 hover:bg-[#501122]/20 text-[#501122] text-[9px] font-bold uppercase tracking-wider transition-colors">
                <Copy className="h-3 w-3" />Copiar
              </button>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-baseline">
                <span className="text-xs text-[#501122]/80">Productos</span>
                <div className="text-right">
                  <span className="font-heading text-sm text-[#501122]" data-testid="of-subtotal-usd">{formatUSD(itemsTotal)}</span>
                  <span className="text-[10px] text-[#78686C] ml-1.5">{formatVES(itemsTotal, bcvRate)}</span>
                </div>
              </div>
              {orderType === 'delivery' && parseFloat(deliveryFee || 0) > 0 && (
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-[#501122]/80">Delivery</span>
                  <div className="text-right">
                    <span className="font-heading text-sm text-[#501122]" data-testid="of-delivery-usd">{formatUSD(parseFloat(deliveryFee || 0))}</span>
                    <span className="text-[10px] text-[#78686C] ml-1.5">{formatVES(parseFloat(deliveryFee || 0), bcvRate)}</span>
                  </div>
                </div>
              )}
              <div className="border-t border-[#501122]/15 pt-2 flex justify-between items-baseline">
                <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#501122]">Total</span>
                <div className="text-right">
                  <p className="font-heading text-2xl text-[#501122] leading-none" data-testid="of-total">{formatUSD(totalUSD)}</p>
                  <p className="text-[10px] text-[#78686C] mt-0.5" data-testid="of-total-ves">{formatVES(totalUSD, bcvRate)}</p>
                </div>
              </div>
            </div>
          </div>
          )}
          <Button onClick={submitOrder} disabled={!hasItems || (!effectiveIsQuote && orderType !== 'tienda' && !selectedCustomerId)}
            className={`w-full h-12 rounded-full text-sm font-bold disabled:opacity-40 transition-all hover:-translate-y-0.5 active:scale-95 shadow-md ${
              effectiveIsQuote
                ? 'bg-[#501122] hover:bg-[#3D0C19] text-white'
                : 'bg-[#3F634A] hover:bg-[#2E4A37] text-white shadow-lg shadow-[#3F634A]/25 ring-2 ring-[#3F634A]/20'
            }`} data-testid="of-submit">
            {effectiveIsQuote ? 'Guardar Cotizacion' : (initialQuote ? 'Convertir en Pedido' : 'Crear Pedido')}
          </Button>
        </div>
      </aside>

      {/* LEFT: form column (all inputs flow top to bottom) */}
      <div className="order-1 min-w-0 space-y-5" data-testid="of-form-wrap">
      {initialQuote && (() => {
        const initialQuoteHasCustomer = !!initialQuote.customer_id;
        const bannerBgClass = initialQuoteHasCustomer ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300';
        const iconBgClass = initialQuoteHasCustomer ? 'bg-emerald-500' : 'bg-red-500';
        const textClass = initialQuoteHasCustomer ? 'text-emerald-700' : 'text-red-700';
        const subtextClass = initialQuoteHasCustomer ? 'text-emerald-600/80' : 'text-red-600/80';
        return (
        <div className={`border-2 rounded-2xl p-4 flex items-center justify-between gap-3 ${bannerBgClass}`} data-testid="of-resuming-quote-banner">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconBgClass}`}>
              <FileText className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className={`text-sm font-bold ${textClass}`}>Retomando cotizacion {initialQuote.order_number}</p>
              <p className={`text-[11px] truncate ${subtextClass}`}>Asigna un cliente y crea el pedido. Los items se cargaron arriba.</p>
            </div>
          </div>
          {onCancelQuote && (
            <button onClick={onCancelQuote} type="button" className={`text-xs font-semibold hover:underline px-2 ${textClass}`} data-testid="of-cancel-quote-btn">Cancelar</button>
          )}
        </div>
        );
      })()}

      {/* Cotizacion ficticia toggle + Cliente en una sola linea */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Cliente</Label>
            {orderType !== 'tienda' && (
              <button onClick={() => setShowCustomerDialog(true)} type="button" className="text-[10px] font-semibold text-[#501122] hover:underline" data-testid="of-new-customer-btn">+ Nuevo</button>
            )}
          </div>
          {orderType !== 'tienda' && (() => {
            const isRegisteredQuote = isQuote && !!selectedCustomerId;
            const toggleBtnClass = isQuote
              ? (isRegisteredQuote ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-red-50 border-red-300 text-red-700')
              : 'bg-white border-[#501122]/15 text-[#78686C]';
            const switchBgClass = isQuote
              ? (isRegisteredQuote ? 'bg-emerald-500' : 'bg-red-500')
              : 'bg-[#501122]/15';
            return (
              <button type="button" onClick={() => setIsQuote(v => !v)} data-testid="of-quote-toggle"
                className={`flex items-center gap-2 h-8 px-3 rounded-full border text-[11px] font-bold uppercase tracking-wider transition-all ${toggleBtnClass}`}>
                <FileText className="h-3.5 w-3.5" />
                Solo cotizacion
                <span className={`w-8 h-4 rounded-full p-0.5 transition-colors shrink-0 ${switchBgClass}`}>
                  <span className={`block w-3 h-3 rounded-full bg-white shadow transition-transform ${isQuote ? 'translate-x-4' : 'translate-x-0'}`}></span>
                </span>
              </button>
            );
          })()}
        </div>
        {orderType === 'tienda' ? (
          <div className="bg-emerald-50 border border-emerald-200/80 rounded-2xl p-3 flex items-center justify-between text-xs text-emerald-900 font-medium" data-testid="of-tienda-no-customer">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-emerald-700 shrink-0" />
              <span>Venta en Tienda: <strong className="font-bold">No se requiere cliente</strong></span>
            </div>
            <span className="text-[10px] text-emerald-700 font-bold uppercase tracking-wide bg-emerald-100 px-2 py-0.5 rounded-md shrink-0">Venta Directa</span>
          </div>
        ) : (
          <div className="flex gap-2 w-full">
            <div className="flex-1 min-w-0">
              <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" data-testid="of-customer-select"
                    className="w-full justify-between h-12 bg-white border-[#501122]/15 text-[#1F1517] hover:bg-[#F3EBE0] rounded-2xl">
                    <span className="truncate">
                      {selectedCustomer ? `${selectedCustomer.name} - ${selectedCustomer.phone}` : 'Buscar cliente...'}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 opacity-40 shrink-0" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0 rounded-2xl border-[#501122]/10">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Escribir nombre o telefono..."
                      value={customerSearch}
                      onValueChange={setCustomerSearch}
                      data-testid="of-customer-search"
                    />
                    <CommandList>
                      <CommandEmpty>No se encontro.</CommandEmpty>
                      {selectedCustomer && (
                        <CommandGroup>
                          <CommandItem
                            value="sin_cliente_deselect"
                            onSelect={() => {
                              setSelectedCustomerId('');
                              setSelectedCustomerObj(null);
                              setCustomerOpen(false);
                            }}
                            className="text-red-600 font-semibold cursor-pointer"
                          >
                            <X className="mr-2 h-4 w-4 text-red-600" />
                            <span>Sin cliente (Quitar selección)</span>
                          </CommandItem>
                        </CommandGroup>
                      )}
                      <CommandGroup>
                        {normalizeCustomers(customers).map(c => (
                          <CommandItem
                            key={c.id}
                            value={`${c.name} ${c.phone}`}
                            onSelect={() => {
                              setSelectedCustomerId(c.id);
                              setSelectedCustomerObj(c);
                              setIsQuote(false); // auto-desmarcar cotizacion al elegir un cliente
                              setCustomerOpen(false);
                            }}
                          >
                            <Check className={`mr-2 h-4 w-4 ${selectedCustomerId === c.id ? 'opacity-100' : 'opacity-0'}`} />
                            <div>{c.name}<span className="ml-2 text-xs text-[#78686C]"><Phone className="h-3 w-3 inline mr-1" />{c.phone}</span></div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            {selectedCustomer && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSelectedCustomerId('');
                  setSelectedCustomerObj(null);
                }}
                className="h-12 w-12 rounded-2xl border-[#501122]/15 text-[#78686C] hover:text-[#501122] hover:bg-[#F3EBE0] flex items-center justify-center shrink-0"
                title="Quitar cliente seleccionado"
                data-testid="of-customer-clear-btn"
              >
                <X className="h-4.5 w-4.5" />
              </Button>
            )}
          </div>
        )}
        {isQuote && (
          <Input
            type="text"
            maxLength={80}
            value={quoteDescription}
            onChange={(e) => setQuoteDescription(e.target.value)}
            placeholder="Descripcion (Ej: Cliente Andrea por WhatsApp)"
            className="bg-red-50/60 border-red-300 focus:border-red-500 text-sm"
            data-testid="of-quote-description-input"
          />
        )}
      </div>

      {/* Flavors */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
        <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-3 block">Sabores</Label>
        {(() => {
          const regular = flavors.filter(f => !f.stock_unlimited);
          const porPedido = flavors.filter(f => f.stock_unlimited);
          const renderFlavor = (f) => {
            const qty = orderItems[f.id]?.quantity || 0;
            const noStock = !f.stock_unlimited && (f.stock || 0) <= 0;
            const atMax = !f.stock_unlimited && qty >= (f.stock || 0);
            return (
              <div key={f.id} data-testid={`of-flavor-${f.id}`}
                className={`h-20 overflow-hidden rounded-2xl border-2 flex transition-all duration-300 ${qty > 0 ? 'border-[#501122] bg-[#501122]/[0.03]' : 'border-[#501122]/10 bg-white'} ${noStock ? 'opacity-70' : ''}`}>
                
                {/* Left Side: Image covering the entire left section as a perfect 1:1 square */}
                <div className="w-20 h-full shrink-0 relative bg-[#F3EBE0] border-r border-[#501122]/5">
                  {f.image ? (
                    <img src={f.image} alt={f.name} className="w-full h-full object-cover absolute inset-0" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#F3EBE0]"><span className="font-heading text-[#501122] text-base font-bold">{(f.name || '?')[0]}</span></div>
                  )}
                </div>

                {/* Right Side: Rest of the information and controls */}
                <div className="flex-1 min-w-0 p-2.5 flex items-center justify-between gap-2.5 h-full">
                  <div className="min-w-0 flex-1 flex flex-col justify-center">
                    <p className="font-heading text-[#501122] text-base truncate font-bold pr-1" title={f.name}>{f.name}</p>
                    <p className="text-sm font-bold text-[#501122]">{formatUSD(f.price_usd)}</p>
                    <p className="text-[10px] mt-0.5">
                      {f.stock_unlimited ? <span className="text-[#78686C]">Por pedido</span> : (noStock ? <span className="text-red-600 font-bold uppercase tracking-wider">Agotado</span> : <span className="text-[#78686C]">{f.stock || 0} disp.</span>)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 pl-1">
                    {qty > 0 && <button type="button" onClick={() => removeFlavor(f.id)} className="w-7 h-7 rounded-full bg-[#F3EBE0] flex items-center justify-center active:scale-90 transition-transform"><Minus className="h-3 w-3 text-[#501122]" /></button>}
                    {qty > 0 && <span className="font-heading text-[#501122] w-4 text-center text-xs font-bold">{qty}</span>}
                    <button type="button" onClick={() => addFlavor(f)} disabled={noStock || atMax} className="w-7 h-7 rounded-full bg-[#501122] text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed active:scale-90 transition-all"><Plus className="h-3 w-3" /></button>
                  </div>
                </div>
              </div>
            );
          };
          const activePorPedidoCount = porPedido.filter(f => (orderItems[f.id]?.quantity || 0) > 0).length;
          return (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {regular.map(renderFlavor)}
              </div>
              {porPedido.length > 0 && (
                <details className="mt-4 group" open={activePorPedidoCount > 0} data-testid="of-por-pedido-accordion">
                  <summary className="cursor-pointer flex items-center justify-between gap-2 px-4 py-3 rounded-2xl bg-[#F3EBE0]/80 hover:bg-[#F3EBE0] border border-[#501122]/10 transition-colors list-none">
                    <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#501122]">
                      <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                      Sabores por pedido
                      <span className="text-[10px] font-normal text-[#78686C]">({porPedido.length})</span>
                      {activePorPedidoCount > 0 && (
                        <span className="ml-1 px-1.5 py-0 rounded-full bg-[#501122] text-white text-[9px] font-bold">{activePorPedidoCount}</span>
                      )}
                    </span>
                  </summary>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {porPedido.map(renderFlavor)}
                  </div>
                </details>
              )}
            </>
          );
        })()}
      </div>

      {/* Order type + Delivery / Pickup info */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-4">
        <div>
          <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-2 block">Tipo de entrega</Label>
          <div className="flex flex-wrap gap-2 bg-[#F0E4D8] rounded-full p-1 w-fit">
            <button type="button" onClick={() => setOrderType('delivery')} data-testid="of-type-delivery"
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all ${orderType === 'delivery' ? 'bg-[#501122] text-white shadow-md' : 'text-[#78686C]'}`}>
              <Truck className="h-4 w-4" />Delivery
            </button>
            <button type="button" onClick={() => setOrderType('pickup')} data-testid="of-type-pickup"
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all ${orderType === 'pickup' ? 'bg-[#501122] text-white shadow-md' : 'text-[#78686C]'}`}>
              <ShoppingBag className="h-4 w-4" />Pickup
            </button>
            <button type="button" onClick={() => { setOrderType('tienda'); setIsQuote(false); }} data-testid="of-type-tienda"
              className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all ${orderType === 'tienda' ? 'bg-emerald-700 text-white shadow-md' : 'text-[#78686C]'}`}>
              <Store className="h-4 w-4" />Tienda
            </button>
          </div>
        </div>

        {orderType === 'delivery' ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5" />Ubicacion (opcional)
                </Label>
                {/* Distance mode toggle */}
                <div className="flex items-center gap-1 bg-[#F0E4D8] rounded-full p-0.5" data-testid="of-distance-mode">
                  <button type="button" onClick={() => setDistanceMode('route')} data-testid="of-mode-route"
                    className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all
                      ${distanceMode === 'route' ? 'bg-[#501122] text-white' : 'text-[#78686C]'}`}>Ruta</button>
                  <button type="button" onClick={() => setDistanceMode('linear')} data-testid="of-mode-linear"
                    className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition-all
                      ${distanceMode === 'linear' ? 'bg-[#501122] text-white' : 'text-[#78686C]'}`}>Linea recta</button>
                </div>
              </div>
              <Input value={deliveryAddress} onChange={(e) => { setDeliveryAddress(e.target.value); setFeeManuallyEdited(false); setOutOfZoneOverride(false); }}
                placeholder="https://maps.google.com/... (vacio = lo buscan)" className="bg-white border-[#501122]/15 h-12 rounded-2xl px-4" data-testid="of-address" />
              {deliveryAddress && (
                <div className="pt-1">
                  {zoneCheckLoading ? (
                    <span className="text-xs text-[#78686C]">Calculando...</span>
                  ) : detectedZone?.route_failed ? (
                    <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-3 space-y-1.5" data-testid="of-route-failed">
                      <p className="text-sm font-bold text-amber-800">No se pudo calcular la ruta</p>
                      <p className="text-[11px] text-amber-700">Google Maps no respondio. Cambia el toggle a <span className="font-bold">&ldquo;Linea recta&rdquo;</span> para una estimacion aproximada.</p>
                      {detectedZone?.linear_distance_km !== undefined && (
                        <p className="text-[10px] text-amber-700">Linea recta: {detectedZone.linear_distance_km} km &middot; ~${detectedZone.linear_cost_usd?.toFixed(2)}</p>
                      )}
                    </div>
                  ) : detectedZone?.distance_km !== undefined ? (
                    <div className="bg-[#3F634A]/10 border border-[#3F634A]/20 rounded-2xl p-3 flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-[#3F634A]">
                        <MapPin className="h-4 w-4 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#501122]">Costo de delivery calculated</p>
                        <p className="text-[10px] text-[#78686C]">
                          {detectedZone.distance_km} km {detectedZone.distance_source === 'linear' ? '(linea recta)' : '(ruta)'} &middot; <span className="font-bold text-[#3F634A]">${detectedZone.delivery_cost_usd?.toFixed(2)}</span>
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Costo delivery (USD)</Label>
                <Input type="number" step="0.01" value={deliveryFee} onChange={(e) => { setDeliveryFee(e.target.value); setFeeManuallyEdited(true); }}
                  placeholder="0.00" className="bg-white border-[#501122]/15 h-12 rounded-2xl px-4" data-testid="of-fee" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Notas (opcional)</Label>
                <Textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} rows={2}
                  placeholder="Instrucciones..." className="bg-white border-[#501122]/15 rounded-2xl resize-none" data-testid="of-notes" />
              </div>
            </div>
          </>
        ) : orderType === 'pickup' ? (
          <>
          <div className="bg-[#C27A29]/10 border border-[#C27A29]/20 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#C27A29] flex items-center justify-center shrink-0"><ShoppingBag className="h-5 w-5 text-white" /></div>
            <div>
              <p className="text-sm font-bold text-[#501122]">Pickup en tienda</p>
              <p className="text-[10px] text-[#78686C]">El cliente retira en tienda.</p>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Notas (opcional)</Label>
            <Textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} rows={2}
              placeholder="Instrucciones..." className="bg-white border-[#501122]/15 rounded-2xl resize-none" data-testid="of-notes" />
          </div>
          </>
        ) : (
          /* orderType === 'tienda' */
          <div className="bg-emerald-50 border border-emerald-200/80 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-700 flex items-center justify-center shrink-0 shadow-xs">
              <Store className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-emerald-900">Venta directa en Tienda</p>
              <p className="text-[11px] text-emerald-700">Venta presencial directa en el local. Sin despacho ni dirección de delivery.</p>
            </div>
          </div>
        )}

        {/* Extras & Opciones secundarias (Opacadas cuando es venta en Tienda) */}
        <div className={`space-y-4 transition-all duration-300 ${orderType === 'tienda' ? 'opacity-35 hover:opacity-100 focus-within:opacity-100' : ''}`}>
          {/* Extras: Velitas + Recibe otra persona */}
          <div className="flex flex-wrap items-center gap-2" data-testid="of-extras-row">
            <button type="button" onClick={() => setVelitas(v => !v)} data-testid="of-velitas-toggle"
              className={`flex items-center gap-2 h-11 px-3 rounded-2xl border text-sm font-semibold transition-all shrink-0
                ${velitas ? 'bg-[#C27A29]/10 border-[#C27A29]/40 text-[#C27A29]' : 'bg-white border-[#501122]/15 text-[#78686C]'}`}>
              <Cake className="h-4 w-4" />Velitas
              <span className={`w-8 h-4 rounded-full p-0.5 transition-colors shrink-0 ${velitas ? 'bg-[#C27A29]' : 'bg-[#501122]/15'}`}>
                <span className={`block w-3 h-3 rounded-full bg-white shadow transition-transform ${velitas ? 'translate-x-4' : 'translate-x-0'}`}></span>
              </span>
            </button>
            {orderType !== 'tienda' && (
              <button type="button" onClick={() => setReceiverEnabled(v => !v)} data-testid="of-receiver-toggle"
                className={`flex items-center gap-2 h-11 px-3 rounded-2xl border text-sm font-semibold transition-all shrink-0
                  ${receiverEnabled ? 'bg-[#501122]/10 border-[#501122]/40 text-[#501122]' : 'bg-white border-[#501122]/15 text-[#78686C]'}`}>
                <UserRoundPlus className="h-4 w-4" />Recibe otra persona
                <span className={`w-8 h-4 rounded-full p-0.5 transition-colors shrink-0 ${receiverEnabled ? 'bg-[#501122]' : 'bg-[#501122]/15'}`}>
                  <span className={`block w-3 h-3 rounded-full bg-white shadow transition-transform ${receiverEnabled ? 'translate-x-4' : 'translate-x-0'}`}></span>
                </span>
              </button>
            )}
            {orderType !== 'tienda' && receiverEnabled && (
              <>
                <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)}
                  placeholder="Nombre" className="bg-white border-[#501122]/15 h-11 rounded-2xl px-3 w-40 flex-1 min-w-[140px]" data-testid="of-receiver-name" />
                <div className="flex gap-1 shrink-0">
                  <Input value={receiverPhonePrefix} onChange={(e) => setReceiverPhonePrefix('+' + e.target.value.replace(/\D/g, ''))}
                    className="bg-white border-[#501122]/15 h-11 rounded-2xl px-2 w-16 text-center text-sm font-medium" data-testid="of-receiver-phone-prefix" />
                  <Input value={receiverPhoneLocal} onChange={(e) => setReceiverPhoneLocal(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="4121234567" className="bg-white border-[#501122]/15 h-11 rounded-2xl px-3 w-40" data-testid="of-receiver-phone" />
                </div>
              </>
            )}
          </div>

          {/* Notas para Tienda */}
          {orderType === 'tienda' && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Notas adicionales (opcional)</Label>
              <Textarea value={orderNotes} onChange={(e) => setOrderNotes(e.target.value)} rows={2}
                placeholder="Ej: Cliente pago en efectivo..." className="bg-white border-[#501122]/15 rounded-2xl resize-none" data-testid="of-notes-tienda" />
            </div>
          )}

          {/* Fecha de entrega (En Cola vs Programada vs De esperar aviso) */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] flex items-center gap-1.5">
              <CalendarClock className="h-3.5 w-3.5" />Fecha de entrega
            </Label>
          <div className="flex flex-wrap gap-2 bg-[#F0E4D8] rounded-2xl p-1.5 w-fit">
            <button type="button" onClick={() => { setScheduleMode('queue'); setScheduledFor(''); setWaitForNotice(false); }} data-testid="of-schedule-queue"
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${scheduleMode === 'queue' && !waitForNotice ? 'bg-[#501122] text-white shadow-md' : 'text-[#78686C]'}`}>
              En cola (ASAP)
            </button>
            <button type="button" onClick={() => {
              setScheduleMode('scheduled');
              setWaitForNotice(false);
              if (!scheduledFor) {
                const now = new Date();
                const pad = (n) => String(n).padStart(2, '0');
                setScheduledFor(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`);
              }
            }} data-testid="of-schedule-scheduled"
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${scheduleMode === 'scheduled' && !waitForNotice ? 'bg-[#501122] text-white shadow-md' : 'text-[#78686C]'}`}>
              Programar
            </button>
            <button type="button" onClick={() => setWaitForNotice(v => !v)} data-testid="of-schedule-wait-notice"
              className={`px-4 py-2 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${waitForNotice ? 'bg-gray-700 text-white shadow-md' : 'text-[#78686C] hover:text-[#501122]'}`}>
              <Hourglass className="h-3.5 w-3.5" />De esperar aviso
            </button>
          </div>
          {scheduleMode === 'scheduled' && !waitForNotice && (
            <Input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)}
              className="bg-white border-[#501122]/15 h-12 rounded-2xl px-4" data-testid="of-scheduled-input" />
          )}
          {waitForNotice && (
            <div className="p-2.5 rounded-xl bg-gray-100 border border-gray-300 text-gray-700 text-xs flex items-center gap-2">
              <Hourglass className="h-4 w-4 shrink-0 text-gray-500 animate-pulse" />
              <span>El pedido queda registrado como <strong>esperar aviso</strong> (aparecerá apagado en gris en el mapa).</span>
            </div>
          )}
        </div>
      </div>
      </div>
      </div>{/* /right form column */}

      {/* New Customer Dialog */}
      <Dialog open={showCustomerDialog} onOpenChange={setShowCustomerDialog}>
        <DialogContent className="bg-white border-[#501122]/10 rounded-[1.5rem]" data-testid="of-customer-dialog">
          <DialogHeader><DialogTitle className="text-[#501122] font-heading">Nuevo Cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={newCustName} onChange={(e) => setNewCustName(e.target.value)} placeholder="Nombre" className="bg-[#F3EBE0] border-[#501122]/10 h-12 rounded-2xl px-4" data-testid="of-newcust-name" />
            <div className="flex gap-2">
              <Input 
                value={newCustPrefix} 
                onChange={(e) => setNewCustPrefix('+' + e.target.value.replace(/\D/g, ''))}
                className="w-20 bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-2 text-center font-medium" 
                data-testid="of-newcust-prefix" 
              />
              <Input value={newCustPhone} onChange={(e) => setNewCustPhone(e.target.value.replace(/\D/g, ''))} placeholder="4124567890" className="bg-[#F3EBE0] border-[#501122]/10 h-12 rounded-2xl px-4 flex-1" data-testid="of-newcust-phone" />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setNewCustGender('M')} data-testid="of-gender-m"
                className={`flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl font-semibold text-sm transition-all border-2
                  ${newCustGender === 'M' ? 'bg-blue-500 text-white border-blue-500 shadow-md' : 'bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-400'}`}>
                <span className="text-lg">&#9794;</span>Hombre
              </button>
              <button type="button" onClick={() => setNewCustGender('F')} data-testid="of-gender-f"
                className={`flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl font-semibold text-sm transition-all border-2
                  ${newCustGender === 'F' ? 'bg-pink-500 text-white border-pink-500 shadow-md' : 'bg-pink-50 text-pink-600 border-pink-200 hover:border-pink-400'}`}>
                <span className="text-lg">&#9792;</span>Mujer
              </button>
            </div>
            <Button onClick={saveNewCustomer} className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full" data-testid="of-newcust-save">Guardar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
