import { useState, useEffect, useCallback, useMemo } from 'react';
import { GoogleMap, Polygon, Marker } from '@react-google-maps/api';
import { toast } from 'sonner';
import api, { formatUSD } from '@/lib/api';
import { SafeMapsLoader, DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLES } from '@/lib/mapsLoader';
import { Loader2, Package, DollarSign } from 'lucide-react';

const PRESETS = [
  { id: 'today', label: 'Hoy' },
  { id: 'yesterday', label: 'Ayer' },
  { id: 'last7', label: '7 dias' },
  { id: 'this_week', label: 'Semana' },
  { id: 'this_month', label: 'Mes' },
  { id: 'last_month', label: 'Mes ant.' },
  { id: 'all', label: 'Todo' },
];

// Color tiers for revenue mode
const colorForRevenue = (revenue) => {
  if (revenue > 20) return '#22c55e';  // green
  if (revenue > 10) return '#eab308';   // yellow
  return '#ef4444';                      // red
};

const COUNT_COLOR = '#501122';

function SalesHeatmapInner({ isLoaded, loadError }) {
  const [preset, setPreset] = useState('this_month');
  const [mode, setMode] = useState('revenue'); // 'revenue' or 'count'
  const [points, setPoints] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = preset === 'all' ? {} : { preset };
      const [hm, zn] = await Promise.all([
        api.get('/orders/heatmap', { params }),
        api.get('/zones'),
      ]);
      setPoints(hm.data?.points || []);
      setZones(Array.isArray(zn.data) ? zn.data : []);
    } catch { toast.error('Error cargando mapa'); }
    setLoading(false);
  }, [preset]);

  useEffect(() => { loadData(); }, [loadData]);

  const drawableZones = useMemo(
    () => zones.filter(z => Array.isArray(z.polygon) && z.polygon.length >= 3),
    [zones]
  );

  // Build marker icon based on mode
  const buildMarkerIcon = (revenue) => {
    if (!window.google) return null;
    const color = mode === 'revenue' ? colorForRevenue(revenue) : COUNT_COLOR;
    return {
      path: window.google.maps.SymbolPath.CIRCLE,
      scale: 7,
      fillColor: color,
      fillOpacity: 0.85,
      strokeColor: '#ffffff',
      strokeWeight: 1.5,
    };
  };

  if (loadError) return <p className="text-center py-20 text-red-500">Error cargando Google Maps. Verifica la API key.</p>;
  if (!isLoaded) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-[#501122]" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-[#F0E4D8] rounded-full p-1 flex-wrap">
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => setPreset(p.id)} data-testid={`heatmap-preset-${p.id}`}
              className={`px-4 py-2 rounded-full text-xs font-semibold transition-all duration-300 ${preset === p.id ? 'bg-white text-[#501122] shadow-sm' : 'text-[#78686C] hover:text-[#501122]'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 bg-[#F0E4D8] rounded-full p-1">
          <button onClick={() => setMode('revenue')} data-testid="heatmap-mode-revenue"
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-300 ${mode === 'revenue' ? 'bg-white text-[#3F634A] shadow-sm' : 'text-[#78686C] hover:text-[#501122]'}`}>
            <DollarSign className="h-3.5 w-3.5" />Por Monto
          </button>
          <button onClick={() => setMode('count')} data-testid="heatmap-mode-count"
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-300 ${mode === 'count' ? 'bg-white text-[#C27A29] shadow-sm' : 'text-[#78686C] hover:text-[#501122]'}`}>
            <Package className="h-3.5 w-3.5" />Por Pedidos
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#78686C] ml-auto" data-testid="heatmap-points-count">
          <span className="font-bold text-[#501122]">{points.length}</span> pedidos
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[#78686C]" />}
      </div>

      {/* Legend (only in revenue mode) */}
      {mode === 'revenue' && (
        <div className="flex flex-wrap items-center gap-4 bg-white border border-[#501122]/10 rounded-2xl px-4 py-2.5 text-xs">
          <span className="font-semibold text-[#78686C] uppercase tracking-wider text-[10px]">Leyenda:</span>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#ef4444]"></span><span className="text-[#1F1517]">$10 o menos</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#eab308]"></span><span className="text-[#1F1517]">$10 a $20</span></div>
          <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#22c55e]"></span><span className="text-[#1F1517]">Mas de $20</span></div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 overflow-hidden shadow-[0_8px_30px_rgba(80,17,34,0.03)]" data-testid="heatmap-container">
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '560px' }}
            center={DEFAULT_CENTER}
            zoom={DEFAULT_ZOOM}
            options={{ styles: MAP_STYLES, streetViewControl: false, mapTypeControl: false, fullscreenControl: true }}
          >
            {drawableZones.map(z => (
              <Polygon
                key={z.id}
                paths={z.polygon.map(([lat, lng]) => ({ lat, lng }))}
                options={{
                  fillColor: z.color || '#501122', fillOpacity: 0.05,
                  strokeColor: z.color || '#501122', strokeWeight: 1.5,
                  strokeOpacity: 0.6, clickable: false,
                }}
              />
            ))}

            {points.map((p, i) => (
              <Marker
                key={`${p.lat}-${p.lng}-${i}`}
                position={{ lat: p.lat, lng: p.lng }}
                icon={buildMarkerIcon(p.revenue)}
                title={`${formatUSD(p.revenue)}`}
              />
            ))}
          </GoogleMap>
        </div>
      </div>

      {points.length === 0 && !loading && (
        <p className="text-center py-6 text-[#78686C] text-sm">No hay pedidos con coordenadas en este periodo.</p>
      )}
    </div>
  );
}

export default function SalesHeatmap(props) {
  return (
    <SafeMapsLoader>
      {({ isLoaded, loadError }) => (
        <SalesHeatmapInner isLoaded={isLoaded} loadError={loadError} {...props} />
      )}
    </SafeMapsLoader>
  );
}
