import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Pencil, MapPin, CalendarClock, DollarSign, FileText, Hourglass, Truck, ShoppingBag, Store, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';
import { AddressMiniMap } from '@/components/OrderForm';
import { getStoredCentralPoint, syncCentralPointWithBackend } from '@/lib/centralPoint';

export default function EditOrderDialog({ order, open, onOpenChange, onSaved }) {
  const [form, setForm] = useState({
    order_type: 'delivery',
    delivery_address: '',
    delivery_fee: '',
    scheduled_for: '',
    notes: '',
    wait_for_notice: false,
  });
  const [detectedCoords, setDetectedCoords] = useState(null);
  const [manualCoords, setManualCoords] = useState(null);
  const [centralPoint, setCentralPoint] = useState(() => getStoredCentralPoint());
  const [calculating, setCalculating] = useState(false);
  const [calcSuccess, setCalcSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/settings').then(s => {
      syncCentralPointWithBackend(s.data);
      const cp = getStoredCentralPoint();
      if (cp) setCentralPoint(cp);
    }).catch(() => {});

    const onSetSync = () => setCentralPoint(getStoredCentralPoint());
    window.addEventListener('lubos:settings-changed', onSetSync);
    return () => window.removeEventListener('lubos:settings-changed', onSetSync);
  }, []);

  useEffect(() => {
    if (!order) return;
    let sched = '';
    if (order.scheduled_for) {
      try {
        const d = new Date(order.scheduled_for);
        if (!isNaN(d.getTime())) {
          const pad = (n) => String(n).padStart(2, '0');
          sched = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        }
      } catch { sched = ''; }
    }
    const oType = order.order_type || 'delivery';
    setForm({
      order_type: oType,
      delivery_address: order.delivery_address || '',
      delivery_fee: order.delivery_fee != null ? String(order.delivery_fee) : '',
      scheduled_for: sched,
      notes: order.notes || '',
      wait_for_notice: !!order.wait_for_notice,
    });
    setManualCoords(null);
    if (typeof order.lat === 'number' && typeof order.lng === 'number') {
      setDetectedCoords({ lat: order.lat, lng: order.lng });
    } else {
      setDetectedCoords(null);
    }
    setCalcSuccess(false);
  }, [order]);

  const calculateCostFromUrl = async (urlText) => {
    const text = urlText || form.delivery_address;
    if (!text || text.trim().length < 5) return;
    setCalculating(true);
    setCalcSuccess(false);
    try {
      const res = await api.post('/zones/check', { url: text.trim(), mode: 'route' });
      if (res.data) {
        if (typeof res.data.lat === 'number' && typeof res.data.lng === 'number') {
          setDetectedCoords({ lat: res.data.lat, lng: res.data.lng });
        }
        const cost = res.data.delivery_cost_usd ?? res.data.linear_cost_usd;
        if (cost != null) {
          setForm(prev => ({ ...prev, delivery_fee: String(cost) }));
          setCalcSuccess(true);
          toast.success(`Costo calculado: $${cost}`);
        } else {
          toast.info('Coordenadas detectadas. Ingresa el costo de delivery si aplica.');
        }
      }
    } catch (err) {
      console.warn('Error recalculating zone/cost:', err);
    } finally {
      setCalculating(false);
    }
  };

  const calculateCostFromCoords = async (coords) => {
    if (!coords) return;
    setCalculating(true);
    try {
      const res = await api.post('/zones/check', { lat: coords.lat, lng: coords.lng, mode: 'route' });
      if (res.data) {
        if (typeof res.data.lat === 'number' && typeof res.data.lng === 'number') {
          setDetectedCoords({ lat: res.data.lat, lng: res.data.lng });
        }
        const cost = res.data.delivery_cost_usd ?? res.data.linear_cost_usd;
        if (cost != null) {
          setForm(prev => ({ ...prev, delivery_fee: String(cost) }));
          setCalcSuccess(true);
          toast.success(`Costo recalculado por posición: $${cost}`);
        }
      }
    } catch (err) {
      console.warn('Error recalculating from coords:', err);
    } finally {
      setCalculating(false);
    }
  };

  const handleOrderTypeChange = (newType) => {
    if (newType === form.order_type) return;
    if (newType === 'pickup' || newType === 'tienda') {
      setForm(prev => ({
        ...prev,
        order_type: newType,
        delivery_fee: '0',
      }));
      setDetectedCoords(null);
      setCalcSuccess(false);
    } else {
      setForm(prev => ({
        ...prev,
        order_type: 'delivery',
      }));
      if (form.delivery_address && form.delivery_address.length > 5) {
        calculateCostFromUrl(form.delivery_address);
      }
    }
  };

  const handleSave = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const isDelivery = form.order_type === 'delivery';
      const payload = {
        order_type: form.order_type,
        delivery_address: isDelivery ? (form.delivery_address || '') : '',
        delivery_fee: isDelivery ? parseFloat(form.delivery_fee || 0) : 0,
        scheduled_for: form.scheduled_for && !isNaN(new Date(form.scheduled_for).getTime()) ? new Date(form.scheduled_for).toISOString() : null,
        notes: form.notes || '',
        wait_for_notice: form.wait_for_notice,
      };
      if (isDelivery && detectedCoords) {
        payload.lat = detectedCoords.lat;
        payload.lng = detectedCoords.lng;
      }
      await api.patch(`/orders/${order.id}`, payload);
      toast.success('Pedido actualizado con éxito');
      onSaved && onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error guardando pedido');
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-[#501122]/10 rounded-[1.5rem] max-w-lg" data-testid="edit-order-dialog">
        <DialogHeader>
          <DialogTitle className="text-[#501122] font-heading flex items-center gap-2">
            <Pencil className="h-4 w-4" />Editar pedido {order?.order_number}
          </DialogTitle>
          <DialogDescription className="text-[#78686C]">
            Modifica tipo de entrega, dirección, costo de delivery, horario o notas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3.5">
          {/* Tipo de Pedido (Delivery vs Pickup) */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">
              Tipo de entrega
            </Label>
            <div className="grid grid-cols-3 gap-2 bg-[#F3EBE0]/60 p-1 rounded-2xl border border-[#501122]/10">
              <button
                type="button"
                onClick={() => handleOrderTypeChange('delivery')}
                data-testid="edit-order-type-delivery"
                className={`h-10 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  form.order_type === 'delivery'
                    ? 'bg-[#501122] text-white shadow-md'
                    : 'text-[#78686C] hover:text-[#501122]'
                }`}
              >
                <Truck className="h-3.5 w-3.5" />
                <span>Delivery</span>
              </button>
              <button
                type="button"
                onClick={() => handleOrderTypeChange('pickup')}
                data-testid="edit-order-type-pickup"
                className={`h-10 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  form.order_type === 'pickup'
                    ? 'bg-[#C27A29] text-white shadow-md'
                    : 'text-[#78686C] hover:text-[#C27A29]'
                }`}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                <span>Pickup</span>
              </button>
              <button
                type="button"
                onClick={() => handleOrderTypeChange('tienda')}
                data-testid="edit-order-type-tienda"
                className={`h-10 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  form.order_type === 'tienda'
                    ? 'bg-emerald-700 text-white shadow-md'
                    : 'text-[#78686C] hover:text-emerald-700'
                }`}
              >
                <Store className="h-3.5 w-3.5" />
                <span>Tienda</span>
              </button>
            </div>
          </div>

          {/* Seccion Delivery (Direccion / Link) */}
          {form.order_type === 'delivery' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />Dirección / Link de ubicación
                </Label>
                <button
                  type="button"
                  onClick={() => calculateCostFromUrl()}
                  disabled={calculating || !form.delivery_address}
                  data-testid="edit-order-calc-cost-btn"
                  className="text-[11px] font-bold text-[#501122] hover:bg-[#F3EBE0] px-2 py-1 rounded-lg transition-colors flex items-center gap-1"
                >
                  {calculating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-[#C27A29]" />}
                  <span>Calcular costo/ubicación</span>
                </button>
              </div>
              <Textarea
                value={form.delivery_address}
                onChange={(e) => {
                  const val = e.target.value;
                  setForm({ ...form, delivery_address: val });
                  if (val.includes('maps') || val.includes('http')) {
                    calculateCostFromUrl(val);
                  }
                }}
                rows={2}
                placeholder="Pegar link de Google Maps, Facebook o dirección textual"
                className="bg-[#F3EBE0] border-[#501122]/10 rounded-2xl resize-none"
                data-testid="edit-order-address"
              />
              {calcSuccess && (
                <div className="flex items-center gap-1.5 text-xs text-[#3F634A] font-semibold bg-[#3F634A]/10 px-3 py-1.5 rounded-xl">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>Ubicación detectada y costo de delivery actualizado</span>
                </div>
              )}
              {(form.delivery_address || detectedCoords || manualCoords) && (
                <div className="mt-2">
                  <AddressMiniMap
                    addressUrl={form.delivery_address}
                    detectedZone={detectedCoords ? { lat: detectedCoords.lat, lng: detectedCoords.lng, delivery_cost_usd: form.delivery_fee ? parseFloat(form.delivery_fee) : undefined } : null}
                    centralPoint={centralPoint}
                    manualCoords={manualCoords}
                    onManualPinChange={(coords) => {
                      setManualCoords(coords);
                      if (coords) {
                        setDetectedCoords(coords);
                        calculateCostFromCoords(coords);
                      }
                    }}
                    waitForNotice={form.wait_for_notice}
                  />
                </div>
              )}
            </div>
          )}

          {/* Costo delivery & Fecha programada */}
          <div className="grid grid-cols-2 gap-3">
            {form.order_type === 'delivery' ? (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5" />Costo delivery
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.delivery_fee}
                  onChange={(e) => setForm({ ...form, delivery_fee: e.target.value })}
                  placeholder="0.00"
                  className="bg-[#F3EBE0] border-[#501122]/10 h-11 rounded-2xl px-3"
                  data-testid="edit-order-fee"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">
                  Costo delivery
                </Label>
                <div className="h-11 rounded-2xl bg-gray-100 border border-gray-200 px-3 flex items-center text-xs text-gray-500 font-medium">
                  $0.00 (Pickup)
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5" />Fecha programada
              </Label>
              <div className="flex gap-1.5">
                <Input
                  type="datetime-local"
                  value={form.scheduled_for}
                  onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })}
                  className="bg-[#F3EBE0] border-[#501122]/10 h-11 rounded-2xl px-2.5 flex-1 text-xs"
                  data-testid="edit-order-schedule"
                />
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    const pad = (n) => String(n).padStart(2, '0');
                    setForm({ ...form, scheduled_for: `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}` });
                  }}
                  className="px-2.5 h-11 rounded-2xl bg-[#501122]/10 hover:bg-[#501122]/20 text-[#501122] text-[11px] font-bold whitespace-nowrap"
                  data-testid="edit-order-schedule-now"
                >
                  Ahora
                </button>
              </div>
            </div>
          </div>

          {/* Esperar aviso toggle */}
          <div className="flex items-center justify-between p-3 rounded-2xl bg-[#F3EBE0]/60 border border-[#501122]/10">
            <div className="flex items-center gap-2">
              <Hourglass className={`h-4 w-4 ${form.wait_for_notice ? 'text-gray-700' : 'text-[#78686C]'}`} />
              <div>
                <p className="text-xs font-bold text-[#501122]">Esperar aviso del cliente</p>
                <p className="text-[10px] text-[#78686C]">El mapa mostrará el pedido apagado en gris.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setForm({ ...form, wait_for_notice: !form.wait_for_notice })}
              data-testid="edit-order-wait-notice-toggle"
              className={`h-8 px-3 rounded-full text-xs font-bold transition-all flex items-center gap-1 ${
                form.wait_for_notice ? 'bg-gray-700 text-white shadow-sm' : 'bg-white border border-[#501122]/15 text-[#78686C]'
              }`}
            >
              {form.wait_for_notice ? 'Activado' : 'Desactivado'}
            </button>
          </div>

          {/* Notas */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />Notas
            </Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
              placeholder="Instrucciones..."
              className="bg-[#F3EBE0] border-[#501122]/10 rounded-2xl resize-none"
              data-testid="edit-order-notes"
            />
          </div>

          {/* Botones */}
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 border-[#501122]/15 text-[#501122] rounded-full h-11"
              data-testid="edit-order-cancel"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={busy}
              className="flex-1 bg-[#501122] hover:bg-[#3D0C19] text-white rounded-full h-11 font-semibold"
              data-testid="edit-order-save"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
