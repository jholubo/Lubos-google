import { useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Copy, Check } from 'lucide-react';

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="flex items-center gap-1 text-[10px] font-semibold uppercase text-[#501122] hover:text-[#3D0C19] transition-colors" data-testid="copy-code-btn">
      {copied ? <><Check className="h-3 w-3" />Copiado</> : <><Copy className="h-3 w-3" />Copiar</>}
    </button>
  );
}

const MESSAGE_FIELDS = [
  { key: 'msg_stock_5', label: 'Cuando queden 5' },
  { key: 'msg_stock_4', label: 'Cuando queden 4' },
  { key: 'msg_stock_3', label: 'Cuando queden 3' },
  { key: 'msg_stock_2', label: 'Cuando queden 2' },
  { key: 'msg_stock_1', label: 'Cuando quede 1' },
  { key: 'msg_out', label: 'Agotados (stock = 0)' },
];

function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function WidgetsSection({ widgetSettings, setWidgetSettings, availableFlavors }) {
  const [savingWidget, setSavingWidget] = useState(false);

  const updateWidgetField = (field, value) => setWidgetSettings(prev => ({ ...prev, [field]: value }));

  const saveWidgetSettings = async () => {
    setSavingWidget(true);
    try {
      const { data } = await api.put('/widget-settings', widgetSettings);
      setWidgetSettings(data);
      toast.success('Textos actualizados');
    } catch { toast.error('Error guardando'); }
    setSavingWidget(false);
  };

  const DOMAIN = window.location.origin;
  const scriptCode = `<script src="${DOMAIN}/lubos-stock.js"><\/script>`;

  if (!widgetSettings) return null;

  const previewText = (stock) => {
    if (stock <= 0) return widgetSettings.msg_out || 'Agotados';
    if (stock <= 5) return widgetSettings['msg_stock_' + stock] || `Quedan ${stock}`;
    return '(sin texto)';
  };

  return (
    <div className="space-y-5">
      <h3 className="font-heading text-xl text-[#501122]">Widget de Stock</h3>

      {/* Step 1: Script */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Paso 1 - Script en el footer de WordPress</p>
          <CopyButton text={scriptCode} />
        </div>
        <pre className="bg-[#1e1e1e] text-[#d4d4d4] text-xs p-4 rounded-2xl overflow-x-auto" data-testid="widget-script-code">{scriptCode}</pre>
        <p className="text-[10px] text-[#78686C] mt-2">Usa el plugin WPCode o pegalo en Apariencia &gt; Editor de temas &gt; footer.php</p>
      </div>

      {/* Step 2: Placeholder explanation */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-3">Paso 2 - Pega el placeholder en cada producto</p>
        <pre className="bg-[#1e1e1e] text-[#d4d4d4] text-xs p-4 rounded-2xl overflow-x-auto">{'<span data-lubos="Clasico"></span>'}</pre>
        <p className="text-[11px] text-[#78686C] mt-3">Cuando queden 1 a 5 unidades aparece el texto correspondiente. Si hay mas de 5, el span queda vacio. Si esta agotado, aparece tu texto y se aplica la clase CSS (ver Paso 3).</p>
      </div>

      {/* Step 3: CSS class dimming + state classes */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-3">Paso 3 - Clases CSS que se aplican automaticamente</p>

        <div className="space-y-4">
          {/* State classes on the span */}
          <div>
            <p className="text-[11px] font-bold text-[#501122] mb-1">A. Clase de estado en el <code className="bg-[#F3EBE0] px-1 rounded font-mono">{`<span data-lubos>`}</code></p>
            <p className="text-[11px] text-[#78686C] mb-2">El widget agregara una de estas clases dependiendo del estado del sabor:</p>
            <div className="bg-[#F3EBE0] rounded-2xl p-3 space-y-1.5 font-mono text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-[#78686C]">Cuando queden 1 a 5 unidades</span>
                <span className="text-[#501122] font-bold">.quedan-x</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#78686C]">Cuando esta agotado (stock 0)</span>
                <span className="text-[#CA1143] font-bold">.agotado</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#78686C]">Cuando hay mas de 5</span>
                <span className="text-[#3F634A] font-bold">(sin clase, vacio)</span>
              </div>
            </div>
            <pre className="bg-[#1e1e1e] text-[#d4d4d4] text-xs p-4 rounded-2xl overflow-x-auto mt-3 whitespace-pre-wrap">{`/* Ejemplo CSS en WordPress */
.quedan-x {
  background: #F3EBE0;
  color: #C27A29;
  padding: 4px 12px;
  border-radius: 999px;
  font-weight: 700;
}
.agotado {
  background: #fee;
  color: #CA1143;
  padding: 4px 12px;
  border-radius: 999px;
  font-weight: 700;
}`}</pre>
          </div>

          {/* Per-flavor slugified class */}
          <div>
            <p className="text-[11px] font-bold text-[#501122] mb-1">B. Clase por sabor (atenuar la tarjeta cuando se agote)</p>
            <p className="text-[11px] text-[#78686C] mb-2">Cuando un sabor llega a 0, el widget inyecta una regla CSS con la version slugificada del nombre. Asigna esa clase al contenedor (card) del producto:</p>
            <div className="bg-[#F3EBE0] rounded-2xl p-3 space-y-1.5 font-mono text-[11px]">
              {(availableFlavors || []).map(f => (
                <div key={f.id} className="flex items-center justify-between gap-3">
                  <span className="text-[#78686C]">{f.name}</span>
                  <span className="text-[#501122] font-bold">.{slugify(f.name)}</span>
                </div>
              ))}
            </div>
            <pre className="bg-[#1e1e1e] text-[#d4d4d4] text-xs p-4 rounded-2xl overflow-x-auto mt-3 whitespace-pre-wrap">{`<div class="card-producto ${availableFlavors[0] ? slugify(availableFlavors[0].name) : 'clasico'}">
  <img src="..." />
  <h3>${availableFlavors[0]?.name || 'Clasico'}</h3>
  <span data-lubos="${availableFlavors[0]?.name || 'Clasico'}"></span>
</div>`}</pre>
          </div>
        </div>
      </div>

      {/* Editable messages */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-1">Textos que apareceran (editables)</p>
        <p className="text-[10px] text-[#78686C] mb-4">Personaliza el mensaje. Por ejemplo: &ldquo;Quedan 3&rdquo;, &ldquo;Pocas unidades&rdquo;, &ldquo;Apurate, 2 ud&rdquo;, etc.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {MESSAGE_FIELDS.map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">{label}</Label>
              <Input value={widgetSettings[key] || ''} onChange={(e) => updateWidgetField(key, e.target.value)}
                className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-10 rounded-xl px-3 text-sm" data-testid={`widget-${key}`} />
            </div>
          ))}
        </div>
        <Button onClick={saveWidgetSettings} disabled={savingWidget} className="bg-[#501122] hover:bg-[#3D0C19] text-white rounded-full h-10 px-6 font-semibold mt-5 shadow-md" data-testid="save-widget-btn">
          {savingWidget ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}Guardar Textos
        </Button>
      </div>

      {/* Live preview */}
      <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-3">Vista previa por estado</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5, 6].map(s => (
            <div key={s} className="bg-[#F3EBE0] rounded-2xl p-4 text-center">
              <p className="text-[10px] uppercase tracking-[0.1em] text-[#78686C] mb-1.5">Stock = {s}</p>
              <p className="font-bold text-[#501122] text-sm min-h-[20px]">{previewText(s)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
