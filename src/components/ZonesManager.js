import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { GoogleMap, Polygon, Polyline, Marker, InfoWindow } from '@react-google-maps/api';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useBackButtonClose } from '@/hooks/useBackButtonClose';
import { SafeMapsLoader, DEFAULT_CENTER, DEFAULT_ZOOM, MAP_STYLES } from '@/lib/mapsLoader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Trash2, Plus, MapPin, Pencil, Save, Check, X, Undo2 } from 'lucide-react';

const PALETTE = ['#501122', '#3F634A', '#C27A29', '#2B4C7E', '#8B2D2D', '#6A4E7E', '#0F766E', '#9F1239'];

function ZonesManagerInner({ isLoaded, loadError }) {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [drawingVertices, setDrawingVertices] = useState([]); // [{lat, lng}, ...]
  const [selectedZoneId, setSelectedZoneId] = useState(null);
  const [editingPolygonId, setEditingPolygonId] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState({ id: null, name: '', delivery_cost_usd: '', color: PALETTE[0], polygon: [] });
  const polygonRefs = useRef({});

  // Close dialog on mobile back button
  useBackButtonClose(dialogOpen, () => setDialogOpen(false));
  useBackButtonClose(drawingMode, () => { setDrawingMode(false); setDrawingVertices([]); });

  const loadZones = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/zones');
      setZones(data);
    } catch { toast.error('Error cargando zonas'); }
    setLoading(false);
  }, []);

  useEffect(() => { loadZones(); }, [loadZones]);

  const drawableZones = useMemo(
    () => zones.filter(z => Array.isArray(z.polygon) && z.polygon.length >= 3),
    [zones]
  );

  // Manual drawing: click on map to add a vertex
  const onMapClick = (e) => {
    if (!drawingMode) return;
    const lat = e.latLng.lat();
    const lng = e.latLng.lng();
    setDrawingVertices(prev => [...prev, { lat, lng }]);
  };

  const startDrawing = () => {
    setDrawingMode(true);
    setDrawingVertices([]);
    setSelectedZoneId(null);
    setEditingPolygonId(null);
    toast.info('Click en el mapa para agregar vertices. Minimo 3 puntos.');
  };

  const cancelDrawing = () => {
    setDrawingMode(false);
    setDrawingVertices([]);
  };

  const undoLastVertex = () => {
    setDrawingVertices(prev => prev.slice(0, -1));
  };

  const finishDrawing = () => {
    if (drawingVertices.length < 3) {
      toast.error('Necesitas al menos 3 puntos');
      return;
    }
    const coords = drawingVertices.map(v => [v.lat, v.lng]);
    setZoneForm({ id: null, name: '', delivery_cost_usd: '', color: PALETTE[zones.length % PALETTE.length], polygon: coords });
    setDialogOpen(true);
    setDrawingMode(false);
    setDrawingVertices([]);
  };

  const openZoneInfo = (zone) => {
    setSelectedZoneId(zone.id);
  };

  const openEditDialog = (zone) => {
    setZoneForm({
      id: zone.id, name: zone.name,
      delivery_cost_usd: '0',
      color: zone.color || PALETTE[0], polygon: zone.polygon
    });
    setDialogOpen(true);
    setSelectedZoneId(null);
  };

  const startEditPolygon = (zoneId) => {
    setEditingPolygonId(zoneId);
    setSelectedZoneId(null);
    toast.info('Arrastra los puntos del poligono. Click "Guardar Poligono" cuando termines.');
  };

  const saveEditedPolygon = async (zoneId) => {
    const polygon = polygonRefs.current[zoneId];
    if (!polygon) return;
    const path = polygon.getPath();
    const coords = [];
    for (let i = 0; i < path.getLength(); i++) {
      const p = path.getAt(i);
      coords.push([p.lat(), p.lng()]);
    }
    try {
      await api.put(`/zones/${zoneId}`, { polygon: coords });
      toast.success('Poligono actualizado');
      setEditingPolygonId(null);
      loadZones();
    } catch { toast.error('Error guardando'); }
  };

  const saveZone = async () => {
    if (!zoneForm.name) { toast.error('Ingresa el nombre de la zona'); return; }
    const payload = {
      name: zoneForm.name,
      delivery_cost_usd: 0,
      color: zoneForm.color,
      polygon: zoneForm.polygon,
    };
    try {
      if (zoneForm.id) {
        await api.put(`/zones/${zoneForm.id}`, { name: payload.name, color: payload.color });
        toast.success('Zona actualizada');
      } else {
        await api.post('/zones', payload);
        toast.success('Zona creada');
      }
      setDialogOpen(false);
      loadZones();
    } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
  };

  const deleteZone = async (zoneId) => {
    if (!window.confirm('Eliminar esta zona?')) return;
    try {
      await api.delete(`/zones/${zoneId}`);
      toast.success('Zona eliminada');
      setSelectedZoneId(null);
      loadZones();
    } catch { toast.error('Error'); }
  };

  if (loadError) return <p className="text-center py-20 text-red-500">Error cargando Google Maps. Verifica la API key.</p>;
  if (!isLoaded) return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-[#501122]" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {!drawingMode ? (
          <Button
            onClick={startDrawing}
            className="bg-[#501122] hover:bg-[#3D0C19] text-white rounded-full h-10 px-5 font-semibold shadow-md transition-all"
            data-testid="zone-draw-toggle"
          >
            <Plus className="h-4 w-4 mr-1.5" />Nueva Zona
          </Button>
        ) : (
          <>
            <Button
              onClick={finishDrawing}
              disabled={drawingVertices.length < 3}
              className="bg-[#3F634A] hover:bg-[#2E4A37] text-white rounded-full h-10 px-5 font-semibold shadow-md disabled:opacity-40"
              data-testid="zone-finish-btn"
            >
              <Check className="h-4 w-4 mr-1.5" />Finalizar ({drawingVertices.length} puntos)
            </Button>
            <Button onClick={undoLastVertex} disabled={drawingVertices.length === 0} variant="outline"
              className="border-[#501122]/15 text-[#501122] rounded-full h-10 px-4" data-testid="zone-undo-btn">
              <Undo2 className="h-4 w-4 mr-1.5" />Deshacer
            </Button>
            <Button onClick={cancelDrawing} variant="ghost" className="text-red-500 rounded-full h-10 px-4" data-testid="zone-cancel-btn">
              <X className="h-4 w-4 mr-1.5" />Cancelar
            </Button>
          </>
        )}
        <p className="text-xs text-[#78686C] flex-1 min-w-0">
          {drawingMode
            ? 'Haz click en el mapa para agregar vertices. Minimo 3 puntos para finalizar.'
            : 'Dibuja zonas en el mapa con su costo de delivery. Click sobre una zona para editar o eliminar.'}
        </p>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[#78686C]" />}
      </div>

      <div className={`bg-white rounded-[1.5rem] border overflow-hidden shadow-[0_8px_30px_rgba(80,17,34,0.03)] transition-all ${drawingMode ? 'border-[#3F634A] ring-2 ring-[#3F634A]/20' : 'border-[#501122]/10'}`} data-testid="zones-map-container">
        <GoogleMap
          mapContainerStyle={{ width: '100%', height: '560px', cursor: drawingMode ? 'crosshair' : 'grab' }}
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          onClick={onMapClick}
          options={{ styles: MAP_STYLES, streetViewControl: false, mapTypeControl: false, fullscreenControl: true, draggableCursor: drawingMode ? 'crosshair' : null }}
        >
          {/* Drawing in progress - show vertices as markers + polygon */}
          {drawingMode && drawingVertices.length > 0 && (
            <>
              {drawingVertices.map((v, i) => (
                <Marker
                  key={`vertex-${i}-${v.lat}-${v.lng}`}
                  position={{ lat: v.lat, lng: v.lng }}
                  label={{ text: String(i + 1), color: 'white', fontSize: '11px', fontWeight: 'bold' }}
                />
              ))}
              {drawingVertices.length >= 2 && drawingVertices.length < 3 && (
                <Polyline
                  path={drawingVertices.map(v => ({ lat: v.lat, lng: v.lng }))}
                  options={{ strokeColor: '#3F634A', strokeWeight: 3, strokeOpacity: 0.8 }}
                />
              )}
              {drawingVertices.length >= 3 && (
                <Polygon
                  paths={drawingVertices.map(v => ({ lat: v.lat, lng: v.lng }))}
                  options={{
                    fillColor: '#3F634A', fillOpacity: 0.25,
                    strokeColor: '#3F634A', strokeWeight: 3, strokeOpacity: 0.9,
                    clickable: false,
                  }}
                />
              )}
            </>
          )}

          {/* Existing zones */}
          {drawableZones.map(z => (
            <Polygon
              key={z.id}
              paths={z.polygon.map(([lat, lng]) => ({ lat, lng }))}
              options={{
                fillColor: z.color || '#501122', fillOpacity: editingPolygonId === z.id ? 0.4 : 0.25,
                strokeColor: z.color || '#501122', strokeWeight: editingPolygonId === z.id ? 3 : 2,
                editable: editingPolygonId === z.id, clickable: !drawingMode,
              }}
              onClick={() => !drawingMode && editingPolygonId !== z.id && openZoneInfo(z)}
              onLoad={(p) => { polygonRefs.current[z.id] = p; }}
            />
          ))}

          {selectedZoneId && (() => {
            const z = zones.find(zz => zz.id === selectedZoneId);
            if (!z) return null;
            const lats = z.polygon.map(p => p[0]);
            const lngs = z.polygon.map(p => p[1]);
            const center = {
              lat: lats.reduce((a, b) => a + b, 0) / lats.length,
              lng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
            };
            return (
              <InfoWindow position={center} onCloseClick={() => setSelectedZoneId(null)}>
                <div className="p-1 min-w-[180px]" data-testid={`zone-info-${z.id}`}>
                  <p className="font-bold text-sm mb-2" style={{ color: z.color }}>{z.name}</p>
                  <div className="flex gap-1.5">
                    <button onClick={() => openEditDialog(z)} className="text-[10px] font-semibold px-2 py-1 bg-gray-100 rounded hover:bg-gray-200" data-testid={`zone-edit-info-${z.id}`}>
                      <Pencil className="h-3 w-3 inline mr-0.5" />Info
                    </button>
                    <button onClick={() => startEditPolygon(z.id)} className="text-[10px] font-semibold px-2 py-1 bg-gray-100 rounded hover:bg-gray-200" data-testid={`zone-edit-poly-${z.id}`}>
                      <MapPin className="h-3 w-3 inline mr-0.5" />Forma
                    </button>
                    <button onClick={() => deleteZone(z.id)} className="text-[10px] font-semibold px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200" data-testid={`zone-delete-${z.id}`}>
                      <Trash2 className="h-3 w-3 inline" />
                    </button>
                  </div>
                </div>
              </InfoWindow>
            );
          })()}
        </GoogleMap>
      </div>

      {editingPolygonId && (
        <div className="bg-[#C27A29]/10 border border-[#C27A29]/30 rounded-2xl p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-[#501122]">Modo edicion de forma activo. Arrastra los vertices del poligono.</p>
          <div className="flex gap-2">
            <Button onClick={() => saveEditedPolygon(editingPolygonId)} className="bg-[#3F634A] hover:bg-[#2E4A37] text-white rounded-full h-9 px-4 text-xs font-semibold" data-testid="save-polygon-btn">
              <Save className="h-3.5 w-3.5 mr-1" />Guardar Forma
            </Button>
            <Button onClick={() => { setEditingPolygonId(null); loadZones(); }} variant="outline" className="rounded-full h-9 px-4 text-xs">Cancelar</Button>
          </div>
        </div>
      )}

      {/* Zone list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {zones.length === 0 ? (
          <p className="col-span-full text-center py-10 text-[#78686C]">Aun no has creado zonas. Click "Nueva Zona" para empezar.</p>
        ) : (
          zones.map(z => (
            <div key={z.id} className="bg-white rounded-2xl border border-[#501122]/10 p-4 flex items-center gap-3 shadow-[0_4px_20px_rgba(80,17,34,0.03)]" data-testid={`zone-card-${z.id}`}>
              <span className="w-3 h-12 rounded-full shrink-0" style={{ background: z.color || '#501122' }}></span>
              <div className="flex-1 min-w-0">
                <p className="font-heading text-[#501122] text-sm truncate">{z.name}</p>
                <p className="text-xs text-[#78686C]">Zona de cobertura</p>
              </div>
              <button onClick={() => openEditDialog(z)} className="w-8 h-8 rounded-full bg-[#F3EBE0] flex items-center justify-center text-[#501122] hover:bg-[#501122] hover:text-white transition-all" data-testid={`zone-edit-${z.id}`}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => deleteZone(z.id)} className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all" data-testid={`zone-card-delete-${z.id}`}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      {/* Zone Info Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-white border-[#501122]/10 rounded-[1.5rem]" data-testid="zone-dialog">
          <DialogHeader><DialogTitle className="text-[#501122] font-heading">{zoneForm.id ? 'Editar Zona' : 'Nueva Zona'}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Nombre de la zona</Label>
              <Input value={zoneForm.name} onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
                placeholder="Ej: Las Delicias, El Castano..." className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-4" data-testid="zone-name-input" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Color</Label>
              <div className="flex flex-wrap gap-2">
                {PALETTE.map(c => (
                  <button key={c} onClick={() => setZoneForm({ ...zoneForm, color: c })}
                    className={`w-9 h-9 rounded-full transition-all ${zoneForm.color === c ? 'ring-2 ring-offset-2 ring-[#501122] scale-110' : ''}`}
                    style={{ background: c }} data-testid={`zone-color-${c}`} />
                ))}
              </div>
            </div>
            <div className="bg-[#F3EBE0] rounded-xl p-3 text-[10px] text-[#78686C]">
              <p>El costo del delivery se calcula automaticamente por distancia desde el punto central. Esta zona solo define el area de cobertura.</p>
            </div>
            <Button onClick={saveZone} className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-semibold shadow-md" data-testid="save-zone-btn">
              {zoneForm.id ? 'Actualizar Zona' : 'Crear Zona'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ZonesManager(props) {
  return (
    <SafeMapsLoader>
      {({ isLoaded, loadError }) => (
        <ZonesManagerInner isLoaded={isLoaded} loadError={loadError} {...props} />
      )}
    </SafeMapsLoader>
  );
}
