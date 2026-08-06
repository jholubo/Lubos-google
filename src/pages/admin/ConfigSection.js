import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api, { formatVES } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCw, MapPin, Truck } from 'lucide-react';

export default function ConfigSection({ settings, exchangeRate, setExchangeRate, onSaved }) {
  const [fetchingRate, setFetchingRate] = useState(false);
  const [centralPointUrl, setCentralPointUrl] = useState('');
  const [savingCentral, setSavingCentral] = useState(false);
  const [deliveryDriverPct, setDeliveryDriverPct] = useState(String(settings.delivery_driver_pct ?? 85));
  const [savingDriverPct, setSavingDriverPct] = useState(false);

  useEffect(() => {
    if (settings.delivery_driver_pct !== undefined) {
      setDeliveryDriverPct(String(settings.delivery_driver_pct));
    }
  }, [settings.delivery_driver_pct]);

  const fetchBCVRate = async () => {
    setFetchingRate(true);
    try {
      const { data } = await api.get('/bcv-rate');
      if (data.rate) {
        setExchangeRate(String(data.rate));
        toast.success(`Tasa actualizada: ${data.rate}`);
        onSaved && onSaved();
      }
    } catch { toast.error('No se pudo obtener la tasa BCV'); }
    setFetchingRate(false);
  };

  const saveSettings = async () => {
    try {
      await api.put('/settings', { exchange_rate_ves: parseFloat(exchangeRate) });
      toast.success('Tasa guardada');
      onSaved && onSaved();
    } catch { toast.error('Error'); }
  };

  const saveDriverPct = async () => {
    const val = parseFloat(deliveryDriverPct);
    if (isNaN(val) || val < 0 || val > 100) {
      toast.error('Ingresa un porcentaje válido entre 0 y 100');
      return;
    }
    setSavingDriverPct(true);
    try {
      await api.put('/settings', { delivery_driver_pct: val });
      toast.success(`Porcentaje del repartidor actualizado a ${val}%`);
      onSaved && onSaved();
    } catch { toast.error('Error guardando porcentaje'); }
    setSavingDriverPct(false);
  };

  const saveCentralPoint = async () => {
    if (!centralPointUrl) { toast.error('Pega un link de Google Maps con la ubicacion de tu tienda'); return; }
    setSavingCentral(true);
    try {
      await api.put('/settings', { central_point_url: centralPointUrl });
      toast.success('Punto central guardado');
      setCentralPointUrl('');
      onSaved && onSaved();
    } catch (err) { toast.error(err.response?.data?.detail || 'Error guardando'); }
    setSavingCentral(false);
  };

  const clearCentralPoint = async () => {
    if (!window.confirm('Quitar el punto central? El delivery volvera a usar costos fijos por zona.')) return;
    try {
      await api.put('/settings', { central_point_url: '' });
      toast.success('Punto central eliminado');
      onSaved && onSaved();
    } catch { toast.error('Error'); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 items-start">
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
        <p className="font-heading text-lg text-[#501122] mb-5">Tasa de Cambio BCV</p>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">1 USD = ? VES</Label>
            <div className="flex gap-2">
              <Input type="number" step="0.0001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)}
                className="bg-white border-[#501122]/15 text-[#1F1517] h-12 rounded-2xl px-4 flex-1" data-testid="exchange-rate-input" />
              <Button onClick={fetchBCVRate} disabled={fetchingRate} variant="outline"
                className="border-[#501122]/15 text-[#501122] h-12 w-12 rounded-full p-0" data-testid="fetch-bcv-btn">
                {fetchingRate ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="bg-[#F3EBE0] rounded-2xl p-4 text-sm text-[#78686C]">
            <p>Ejemplo: $10.00 = {formatVES(10, parseFloat(exchangeRate) || 0)}</p>
          </div>
          {settings.updated_at && <p className="text-[10px] text-[#78686C]">Ultima actualizacion: {new Date(settings.updated_at).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>}
          <Button onClick={saveSettings} className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-semibold shadow-md" data-testid="save-settings-btn">Guardar Tasa</Button>
        </div>
      </div>

      {/* Delivery Fee Split Configuration */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)]" data-testid="delivery-pct-card">
        <p className="font-heading text-lg text-[#501122] mb-1 flex items-center gap-2">
          <Truck className="h-5 w-5 text-[#3F634A]" />Repartición del Cobro de Delivery
        </p>
        <p className="text-xs text-[#78686C] mb-4">
          Porcentaje que recibe el repartidor. Los repartidores verán únicamente la ganancia que les corresponde.
        </p>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Porcentaje Repartidor (%)</Label>
            <div className="flex gap-2 items-center">
              <Input
                type="number"
                min="0"
                max="100"
                step="1"
                value={deliveryDriverPct}
                onChange={(e) => setDeliveryDriverPct(e.target.value)}
                className="bg-white border-[#501122]/15 text-[#1F1517] h-12 rounded-2xl px-4 flex-1 text-base font-bold text-[#3F634A]"
                data-testid="delivery-driver-pct-input"
              />
              <span className="font-bold text-[#501122] text-lg">%</span>
            </div>
          </div>

          {(() => {
            const pct = parseFloat(deliveryDriverPct) || 85;
            const companyPct = Math.max(0, 100 - pct);
            const exampleFee = 10.0;
            const driverEarn = (exampleFee * pct) / 100;
            const companyEarn = (exampleFee * companyPct) / 100;
            return (
              <div className="bg-[#F3EBE0]/70 border border-[#501122]/5 rounded-2xl p-4 space-y-2 text-xs">
                <p className="font-bold text-[#501122]">Desglose del cobro:</p>
                <div className="grid grid-cols-2 gap-2 text-center pt-1">
                  <div className="bg-[#3F634A]/10 border border-[#3F634A]/20 rounded-xl p-2.5">
                    <p className="text-[10px] uppercase font-bold text-[#3F634A]">Repartidor ({pct}%)</p>
                    <p className="font-heading text-base font-bold text-[#3F634A]">${driverEarn.toFixed(2)}</p>
                  </div>
                  <div className="bg-[#501122]/10 border border-[#501122]/20 rounded-xl p-2.5">
                    <p className="text-[10px] uppercase font-bold text-[#501122]">Empresa ({companyPct}%)</p>
                    <p className="font-heading text-base font-bold text-[#501122]">${companyEarn.toFixed(2)}</p>
                  </div>
                </div>
                <p className="text-[10px] text-[#78686C] pt-1">
                  * Ejemplo sobre un flete de ${exampleFee.toFixed(2)}. El repartidor solo verá ${driverEarn.toFixed(2)} en sus pedidos.
                </p>
              </div>
            );
          })()}

          <Button
            onClick={saveDriverPct}
            disabled={savingDriverPct}
            className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-semibold shadow-md"
            data-testid="save-delivery-pct-btn"
          >
            {savingDriverPct ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Guardar Porcentaje
          </Button>
        </div>
      </div>

      {/* Central Point for Distance-based Delivery */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)]" data-testid="central-point-card">
        <p className="font-heading text-lg text-[#501122] mb-1 flex items-center gap-2"><MapPin className="h-5 w-5" />Punto Central de Delivery</p>
        <p className="text-xs text-[#78686C] mb-4">El costo del delivery se calcula segun la distancia desde este punto.</p>

        {settings.central_point_lat && settings.central_point_lng ? (
          <div className="bg-[#3F634A]/10 border border-[#3F634A]/20 rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#3F634A]">Configurado</p>
              <button onClick={clearCentralPoint} className="text-[10px] font-semibold text-red-500 hover:text-red-600" data-testid="clear-central-btn">Quitar</button>
            </div>
            <p className="text-xs text-[#501122] font-mono">{settings.central_point_lat.toFixed(6)}, {settings.central_point_lng.toFixed(6)}</p>
            <a href={`https://maps.google.com/?q=${settings.central_point_lat},${settings.central_point_lng}`} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#3F634A] hover:underline mt-1 inline-block">Ver en Google Maps &rarr;</a>
          </div>
        ) : (
          <div className="bg-[#C27A29]/10 border border-[#C27A29]/20 rounded-2xl p-4 mb-4 text-xs text-[#C27A29]">
            No configurado. Sin punto central, el costo del delivery sera el valor fijo de cada zona.
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Link de Google Maps</Label>
            <Input value={centralPointUrl} onChange={(e) => setCentralPointUrl(e.target.value)}
              placeholder="https://maps.google.com/?q=10.2469,-67.5958"
              className="bg-white border-[#501122]/15 text-[#1F1517] h-12 rounded-2xl px-4 text-xs" data-testid="central-point-input" />
          </div>
          <Button onClick={saveCentralPoint} disabled={savingCentral} className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-semibold shadow-md" data-testid="save-central-btn">
            {savingCentral ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Guardar Punto Central
          </Button>
          <div className="bg-[#F3EBE0] rounded-2xl p-3 text-[10px] text-[#78686C] space-y-1">
            <p className="font-bold text-[#501122]">Formula de costo:</p>
            <p>&middot; 0 a 3 km: <span className="font-bold">$1.50</span> (tarifa plana)</p>
            <p>&middot; A partir de 3 km: <span className="font-bold">+$0.50 por km</span></p>
            <p>&middot; Ejemplo: 5 km = $2.20 &middot; 10 km = $4.20 &middot; 20 km = $8.20</p>
          </div>
        </div>
      </div>
    </div>
  );
}
