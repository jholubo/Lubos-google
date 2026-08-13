import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import api, { formatVES } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Loader2, RefreshCw, MapPin, Truck, Radio, Smartphone, Copy, Check, Clock, QrCode
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { saveCentralPointCoords } from '@/lib/centralPoint';
import { setLocalCache } from '@/lib/cache';

export default function ConfigSection({ settings, exchangeRate, setExchangeRate, onSaved }) {
  const [fetchingRate, setFetchingRate] = useState(false);
  const [centralPointUrl, setCentralPointUrl] = useState('');
  const [savingCentral, setSavingCentral] = useState(false);
  const [deliveryDriverPct, setDeliveryDriverPct] = useState(String(settings.delivery_driver_pct ?? 85));
  const [savingDriverPct, setSavingDriverPct] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  const traccarEndpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/traccar` : 'https://.../api/traccar';

  const copyTraccarUrl = () => {
    try {
      navigator.clipboard.writeText(traccarEndpoint);
      setCopiedUrl(true);
      toast.success('URL del servidor Traccar copiada');
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      toast.error('No se pudo copiar automáticamente');
    }
  };

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
      const res = await api.put('/settings', { central_point_url: centralPointUrl });
      if (res.data?.central_point_lat && res.data?.central_point_lng) {
        saveCentralPointCoords(res.data.central_point_lat, res.data.central_point_lng, centralPointUrl);
      }
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
      setLocalCache('store_central_point', null);
      window.dispatchEvent(new CustomEvent('lubos:settings-changed'));
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

      {/* Traccar Client GPS Tracking Info & QR Generator Card */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)] md:col-span-2 lg:col-span-3" data-testid="traccar-config-card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <p className="font-heading text-lg text-[#501122] flex items-center gap-2">
            <Radio className="h-5 w-5 text-emerald-600 animate-pulse" />
            Configuración Rápida por Código QR (Traccar Client)
          </p>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Vincular Servidor con QR
          </span>
        </div>
        <p className="text-xs text-[#78686C] mb-6">
          Abre la app <strong className="text-[#501122]">Traccar Client</strong> en el teléfono del repartidor, ingresa en <strong className="text-[#501122]">Ajustes</strong>, toca el botón de <strong className="text-[#501122]">Código QR</strong> al lado de "URL del servidor" y escanea este código:
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* QR Server URL */}
          <div className="bg-[#F3EBE0]/60 border border-[#501122]/10 rounded-2xl p-5 flex flex-col items-center text-center space-y-4">
            <div className="w-full flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-[#501122] bg-white border border-[#501122]/15 px-2.5 py-1 rounded-full">
                QR DEL SERVIDOR
              </span>
              <QrCode className="h-4 w-4 text-[#501122]" />
            </div>

            <div className="bg-white p-4 rounded-2xl border border-[#501122]/15 shadow-sm flex items-center justify-center">
              <QRCodeSVG
                value={traccarEndpoint}
                size={180}
                bgColor={"#FFFFFF"}
                fgColor={"#501122"}
                level={"L"}
                includeMargin={false}
              />
            </div>

            <div className="w-full text-left space-y-2">
              <p className="text-xs font-bold text-[#501122] flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5 text-[#501122]" /> URL del Servidor
              </p>
              <p className="text-[11px] text-[#78686C]">
                Escanea dentro de Traccar: <strong className="text-[#1F1517]">Ajustes &rarr; URL del Servidor (escáner QR)</strong>
              </p>
              <div className="flex items-center gap-2 bg-white border border-[#501122]/15 rounded-xl p-2.5 shadow-inner mt-2">
                <code className="text-[11px] font-mono text-[#501122] flex-1 break-all font-semibold">{traccarEndpoint}</code>
                <Button
                  onClick={copyTraccarUrl}
                  type="button"
                  variant="outline"
                  className="h-8 px-2.5 rounded-lg border-[#501122]/20 text-[#501122] hover:bg-[#501122] hover:text-white shrink-0 text-[11px] font-bold transition-all"
                  data-testid="copy-traccar-url-btn"
                >
                  {copiedUrl ? <Check className="h-3 w-3 text-emerald-600 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                  {copiedUrl ? 'Copiado' : 'Copiar'}
                </Button>
              </div>
            </div>
          </div>

          {/* Instructions & Checklist */}
          <div className="bg-white border border-[#501122]/10 rounded-2xl p-5 space-y-3.5 text-xs">
            <p className="font-bold text-[#501122] uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-[#C27A29]" /> Configuración del Celular del Repartidor:
            </p>

            <ol className="space-y-2 text-[#1F1517] list-decimal list-inside leading-relaxed text-[11px]">
              <li>Abrir la app gratuita <strong className="text-[#501122]">Traccar Client</strong>.</li>
              <li>Entrar en <strong className="text-[#501122]">Ajustes</strong>.</li>
              <li>En <strong className="text-[#501122]">Identificador de dispositivo</strong>, colocar el nombre o usuario del repartidor (ej: <code className="bg-[#F3EBE0] px-1.5 py-0.5 rounded font-mono text-[11px] font-bold">Víctor</code>).</li>
              <li>Tocar el icono de <strong className="text-[#501122]">Código QR</strong> al lado de <strong>URL del Servidor</strong> y escanear el QR mostrado a la izquierda.</li>
              <li>Ajustes recomendados en la app:
                <ul className="pl-4 mt-1 space-y-0.5 text-[#78686C] list-disc text-[10.5px]">
                  <li>Precisión de ubicación: <strong>Máxima</strong></li>
                  <li>Distancia: <strong>0 a 10 metros</strong></li>
                  <li>Intervalo: <strong>5 segundos</strong></li>
                </ul>
              </li>
              <li>En la pantalla principal de Traccar Client, activar el switch <strong className="text-emerald-700">"Estado del servicio"</strong>.</li>
            </ol>

            <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-3 space-y-1.5 text-[11px]">
              <p className="font-bold text-amber-900 flex items-center gap-1">
                <Smartphone className="h-3.5 w-3.5 text-amber-700" /> Nota especial para iPhone (iOS):
              </p>
              <ul className="list-disc list-inside space-y-1 text-amber-800 text-[10.5px] leading-tight">
                <li><strong>Permisos de Ubicación:</strong> Al activar "Estado del servicio", iPhone te pedirá permiso de ubicación. Selecciona <strong>"Al usar la app"</strong> o <strong>"Siempre"</strong>.</li>
                <li><strong>Probar sin moverte:</strong> En iPhone, Traccar no envía señal si estás detenido. Si quieres probar sin caminar/manejar, cambia la <strong>Distancia a 0 metros</strong> en los Ajustes de Traccar.</li>
                <li><strong>Ahorro de batería:</strong> Desactiva el modo "Ahorro de batería" del teléfono para que el GPS siga enviando datos en segundo plano.</li>
              </ul>
            </div>

            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-1">
              <p className="font-bold text-emerald-800 text-[11px]">¡Transmisión en vivo activa!</p>
              <p className="text-[10px] text-emerald-700">
                Al encender el servicio en la app, la posición del repartidor se actualizará automáticamente en el Mapa de Entregas.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
