import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useBackButtonClose } from '@/hooks/useBackButtonClose';
import { toast } from 'sonner';
import api, { formatUSD, formatVES } from '@/lib/api';
import { getLocalCache, setLocalCache } from '@/lib/cache';
import { getStoredCentralPoint, syncCentralPointWithBackend } from '@/lib/centralPoint';
import { notifyLocalChange } from '@/lib/dataSync';
import { useNotifications, playNotificationSound } from '@/hooks/useNotifications';
import usePushSubscription from '@/hooks/usePushSubscription';
import { fuzzyMatch, fuzzyCommandFilter } from '@/lib/searchUtils';
import { fileToCompressedDataUrl } from '@/lib/imageUtils';
import Avatar from '@/components/Avatar';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger, PopoverClose } from '@/components/ui/popover';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LabelList } from 'recharts';
import { LayoutDashboard, ShoppingBag, Store, IceCream2, Users, Settings, Plus, Pencil, Trash2, CalendarDays, DollarSign, Package, TrendingUp, RefreshCw, Loader2, UserCheck, Phone, MessageCircle, Code2, Check, Download, Clock, Target, Percent, UserPlus, Repeat, Award, MapPin, Flame, Truck, ImagePlus, X, PlusCircle, FileText, History, Plus as PlusIcon, Minus, Wallet, Hourglass, Undo2, ChevronDown, PackageCheck, ChevronUp, ChevronDown as ChevronDownIcon, Camera, Cake, Frame, Layers, CalendarClock, UserRound, MoreVertical, Upload } from 'lucide-react';
import SalesHeatmap from '@/components/SalesHeatmap';
import ErrorBoundary from '@/components/ErrorBoundary';
import OrderForm from '@/components/OrderForm';
import DeliveryMap from '@/components/DeliveryMap';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import EditOrderDialog from '@/components/EditOrderDialog';
import WidgetsSection from '@/pages/admin/WidgetsSection';
import ConfigSection from '@/pages/admin/ConfigSection';
import Sidebar, { useSidebarCollapsed } from '@/components/Sidebar';

const statusColors = {
  sin_pagar: 'bg-[#C27A29]/15 text-[#C27A29]',
  pendiente: 'bg-[#C27A29]/10 text-[#C27A29]',
  en_camino: 'bg-blue-100 text-blue-700',
  entregado: 'bg-[#3F634A]/15 text-[#3F634A]',
  cancelado: 'bg-red-100 text-red-700',
};
const statusLabels = { sin_pagar: 'Sin Pagar', pendiente: 'Pendiente', en_camino: 'En Camino', entregado: 'Entregado', cancelado: 'Cancelado' };
const roleLabels = { admin: 'Admin', vendedor: 'Vendedor', delivery: 'Repartidor' };

export default function AdminDashboard({ role = 'admin' } = {}) {
  const isAdmin = role === 'admin';
  usePushSubscription();
  const { user: authUser, refreshUser } = useAuth();
  const sidebarCollapsed = useSidebarCollapsed();
  const [mapColWidth, setMapColWidth] = useState(() => {
    try { const v = parseInt(localStorage.getItem('lubos-pedmap-w') || '520', 10); return Math.max(360, Math.min(900, v)); } catch { return 520; }
  });
  const mapResizeRef = useRef(null); // { startX, startW }
  useEffect(() => {
    const onMove = (e) => {
      const st = mapResizeRef.current;
      if (!st) return;
      const clientX = e.touches ? (e.touches[0]?.clientX ?? st.startX) : e.clientX;
      // Handle is on the LEFT edge → dragging left widens map, dragging right narrows.
      const delta = st.startX - clientX;
      const next = Math.max(360, Math.min(900, st.startW + delta));
      setMapColWidth(next);
      if (e.cancelable && e.touches) e.preventDefault();
    };
    const stop = () => {
      if (mapResizeRef.current) {
        try { localStorage.setItem('lubos-pedmap-w', String(mapColWidth)); } catch { /* ignore */ }
      }
      mapResizeRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', stop);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', stop);
    };
  }, [mapColWidth]);

  const [activeSection, setActiveSection] = useState(role === 'vendor' ? 'clientes' : 'resumen');
  const [configSubSection, setConfigSubSection] = useState('general');
  const [stats, setStats] = useState(() => getLocalCache('admin_stats') || null);
  const [orders, setOrders] = useState(() => getLocalCache('admin_orders') || []);
  const [flavors, setFlavors] = useState(() => getLocalCache('flavors') || []);
  const [users, setUsers] = useState(() => getLocalCache('users') || []);
  const [deliveryLocations, setDeliveryLocations] = useState([]);
  const [settings, setSettings] = useState(() => getLocalCache('settings') || { exchange_rate_ves: 36.5 });
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [statusFilter, setStatusFilter] = useState(['all']);

  // Optimistic override lock to prevent polling / SSE race condition flickering
  const pendingOptimisticOrdersRef = useRef(new Map());

  const applyOptimisticOrderUpdate = useCallback((orderId, patch) => {
    pendingOptimisticOrdersRef.current.set(orderId, { patch, timestamp: Date.now() });
    setOrders(prev => (Array.isArray(prev) ? prev : []).map(o => o.id === orderId ? { ...o, ...patch } : o));
  }, []);

  const clearOptimisticOrderUpdate = useCallback((orderId) => {
    pendingOptimisticOrdersRef.current.delete(orderId);
  }, []);

  const toggleStatusFilter = (id) => {
    if (id === 'all') {
      setStatusFilter(['all']);
    } else {
      setStatusFilter(prev => {
        const withoutAll = prev.filter(x => x !== 'all');
        if (withoutAll.includes(id)) {
          const next = withoutAll.filter(x => x !== id);
          return next.length === 0 ? ['all'] : next;
        } else {
          return [...withoutAll, id];
        }
      });
    }
  };
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'delivery' | 'pickup'
  const [pedidosLimit, setPedidosLimit] = useState(20);

  const STATUS_CHIPS = [
    { id: 'all', label: 'Todos', icon: Layers, cls: 'bg-[#501122] text-white' },
    { id: 'pendiente', label: 'Pendiente', icon: Hourglass, cls: 'bg-[#C27A29] text-white' },
    { id: 'en_camino', label: 'En Camino', icon: Truck, cls: 'bg-blue-500 text-white' },
    { id: 'entregado', label: 'Entregado', icon: PackageCheck, cls: 'bg-[#3F634A] text-white' },
    { id: 'cancelado', label: 'Cancelado', icon: X, cls: 'bg-red-500 text-white' },
  ];
  const [showFlavorDialog, setShowFlavorDialog] = useState(false);
  const [editingFlavor, setEditingFlavor] = useState(null);
  const [flavorForm, setFlavorForm] = useState({ name: '', price_usd: '', available: true, stock: '', stock_unlimited: false, image: '' });
  const [showUserDialog, setShowUserDialog] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userForm, setUserForm] = useState({ name: '', username: '', password: '', role: 'vendedor', color: '#501122' });
  const [exchangeRate, setExchangeRate] = useState('');
  const { notifications } = useNotifications();

  const [clientStats, setClientStats] = useState(null);
  const [clientPeriod, setClientPeriod] = useState('all');
  const [clientSearch, setClientSearch] = useState('');
  const [loadingClientStats, setLoadingClientStats] = useState(false);
  const [showClientDialog, setShowClientDialog] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [clientHistory, setClientHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Create/edit customer
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [customerForm, setCustomerForm] = useState({ name: '', prefix: '+58', phone: '', gender: null });

  // Mobile back button closes dialogs instead of exiting the app
  useBackButtonClose(showFlavorDialog, () => setShowFlavorDialog(false));
  useBackButtonClose(showUserDialog, () => setShowUserDialog(false));
  useBackButtonClose(showClientDialog, () => setShowClientDialog(false));
  useBackButtonClose(showCustomerForm, () => setShowCustomerForm(false));

  // Widget settings
  const [widgetSettings, setWidgetSettings] = useState(null);

  // Report state
  const [report, setReport] = useState(null);
  const [reportPreset, setReportPreset] = useState('today');
  const [reportDateFrom, setReportDateFrom] = useState(null);
  const [reportDateTo, setReportDateTo] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);

  // CSV Import state
  const [showImportCustomersDialog, setShowImportCustomersDialog] = useState(false);
  const [importedNewCustomers, setImportedNewCustomers] = useState([]);
  const [savingImportGenders, setSavingImportGenders] = useState(false);
  const fileInputRef = useRef(null);
  const [isImporting, setIsImporting] = useState(false);
  useBackButtonClose(showImportCustomersDialog, () => setShowImportCustomersDialog(false));

  // Quotes (cotizaciones ficticias)
  const [quotes, setQuotes] = useState([]);
  const [resumingQuote, setResumingQuote] = useState(null);
  const [selectedCustomerForOrder, setSelectedCustomerForOrder] = useState(null);

  // Stock movements
  const [showStockDialog, setShowStockDialog] = useState(false);
  const [stockFlavor, setStockFlavor] = useState(null);
  const [stockMovements, setStockMovements] = useState([]);
  const [stockDelta, setStockDelta] = useState('');
  const [stockDesc, setStockDesc] = useState('');
  useBackButtonClose(showStockDialog, () => setShowStockDialog(false));

  // Finanzas
  const [financeDate, setFinanceDate] = useState(() => {
    // Default to today in VE timezone (YYYY-MM-DD)
    const ve = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Caracas' }));
    return `${ve.getFullYear()}-${String(ve.getMonth() + 1).padStart(2, '0')}-${String(ve.getDate()).padStart(2, '0')}`;
  });
  const [financeData, setFinanceData] = useState(null);
  const [loadingFinance, setLoadingFinance] = useState(false);
  const [expandedFinanceDelivery, setExpandedFinanceDelivery] = useState(null);

  const loadFast = useCallback(async () => {
    try {
      const [st, ord, locs] = await Promise.all([
        api.get('/dashboard/stats'),
        api.get('/orders'),
        api.get('/delivery/locations').catch(() => ({ data: [] })),
      ]);
      setStats(st.data);
      setLocalCache('admin_stats', st.data);

      const now = Date.now();
      const rawOrders = ord.data || [];
      const mergedOrders = rawOrders
        .filter(o => {
          const pending = pendingOptimisticOrdersRef.current.get(o.id);
          if (pending && pending.deleted && now - pending.timestamp < 5000) return false;
          return true;
        })
        .map(o => {
          const pending = pendingOptimisticOrdersRef.current.get(o.id);
          if (pending && !pending.deleted && now - pending.timestamp < 5000) {
            return { ...o, ...pending.patch };
          }
          return o;
        });

      for (const [id, value] of pendingOptimisticOrdersRef.current.entries()) {
        if (now - value.timestamp >= 5000) {
          pendingOptimisticOrdersRef.current.delete(id);
        }
      }

      setOrders(mergedOrders);
      setLocalCache('admin_orders', mergedOrders);
      setDeliveryLocations(locs.data || []);
    } catch { /* silencio en polling */ }
  }, []);

  const loadSlow = useCallback(async () => {
    try {
      const usersEndpoint = isAdmin ? '/users' : '/users/deliveries';
      const [fl, us, se] = await Promise.all([
        api.get('/flavors'), api.get(usersEndpoint), api.get('/settings'),
      ]);
      setFlavors(fl.data); setLocalCache('flavors', fl.data);
      setUsers(us.data); setLocalCache('users', us.data);
      setSettings(se.data); setLocalCache('settings', se.data);
      syncCentralPointWithBackend(se.data);
      setExchangeRate(String(se.data.exchange_rate_ves || 36.5));
    } catch { toast.error('Error cargando datos'); }
  }, [isAdmin]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadFast(), loadSlow()]);
  }, [loadFast, loadSlow]);

  useEffect(() => {
    loadFast();
    loadSlow();
    const interval = setInterval(loadFast, 10000);
    const onVisible = () => { if (document.visibilityState === 'visible') loadFast(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', loadFast);
    // Refresco instantaneo cuando se crea/modifica un pedido o recurso
    const onLocationUpdate = (e) => {
      const payload = e.detail;
      if (!payload || typeof payload.lat !== 'number' || typeof payload.lng !== 'number') return;
      setDeliveryLocations(prev => {
        const driverId = payload.driver_id;
        const existing = (prev || []).find(d => d.delivery_id === driverId);
        if (existing && existing.updated_at && payload.updated_at) {
          const existingTime = new Date(existing.updated_at).getTime();
          const incomingTime = new Date(payload.updated_at).getTime();
          if (existingTime >= incomingTime) {
            // Discard older queued locations to stay perfectly updated on the latest position
            return prev;
          }
        }
        const filtered = (prev || []).filter(d => d.delivery_id !== driverId);
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
    const onOrdersSync = () => { loadFast(); loadQuotes(); };
    const onNotifsSync = () => loadFast();
    const onFlavorsSync = () => loadSlow();
    const onSettingsSync = () => loadSlow();

    window.addEventListener('lubos:orders-changed', onOrdersSync);
    window.addEventListener('lubos:notifications-changed', onNotifsSync);
    window.addEventListener('lubos:flavors-changed', onFlavorsSync);
    window.addEventListener('lubos:settings-changed', onSettingsSync);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', loadFast);
      window.removeEventListener('lubos:location_update', onLocationUpdate);
      window.removeEventListener('lubos:orders-changed', onOrdersSync);
      window.removeEventListener('lubos:notifications-changed', onNotifsSync);
      window.removeEventListener('lubos:flavors-changed', onFlavorsSync);
      window.removeEventListener('lubos:settings-changed', onSettingsSync);
    };
  }, [loadFast, loadSlow]);

  const loadClientStats = useCallback(async (searchQuery = clientSearch) => {
    const cached = getLocalCache('admin_client_stats');
    if (cached && !searchQuery.trim()) setClientStats(cached);

    setLoadingClientStats(true);
    try {
      const params = { limit: 50 };
      if (clientPeriod !== 'all') params.period = clientPeriod;
      if (searchQuery.trim()) params.q = searchQuery.trim();

      const { data } = await api.get('/dashboard/client-stats', { params });
      setClientStats(data);
      if (!searchQuery.trim()) setLocalCache('admin_client_stats', data);
    } catch { toast.error('Error cargando estadisticas'); }
    setLoadingClientStats(false);
  }, [clientPeriod, clientSearch]);

  useEffect(() => {
    if (activeSection === 'clientes') {
      const timer = setTimeout(() => {
        loadClientStats(clientSearch);
      }, clientSearch ? 300 : 0);
      return () => clearTimeout(timer);
    }
  }, [activeSection, clientPeriod, clientSearch, loadClientStats]);

  useEffect(() => {
    const handleSync = () => {
      if (activeSection === 'clientes') {
        loadClientStats(clientSearch);
      }
    };
    window.addEventListener('lubos:customers-changed', handleSync);
    window.addEventListener('lubos:orders-changed', handleSync);
    return () => {
      window.removeEventListener('lubos:customers-changed', handleSync);
      window.removeEventListener('lubos:orders-changed', handleSync);
    };
  }, [activeSection, clientSearch, loadClientStats]);

  const loadReport = useCallback(async () => {
    setLoadingReport(true);
    try {
      const params = {};
      if (reportPreset === 'custom') {
        if (reportDateFrom) params.date_from = reportDateFrom.toISOString().split('T')[0];
        if (reportDateTo) params.date_to = reportDateTo.toISOString().split('T')[0];
      } else {
        params.preset = reportPreset;
      }
      const { data } = await api.get('/dashboard/report', { params });
      setReport(data);
    } catch { toast.error('Error cargando reporte'); }
    setLoadingReport(false);
  }, [reportPreset, reportDateFrom, reportDateTo]);

  useEffect(() => { if (activeSection === 'resumen') loadReport(); }, [activeSection, loadReport]);

  const exportReport = async () => {
    try {
      const params = {};
      if (reportPreset === 'custom') {
        if (reportDateFrom) params.date_from = reportDateFrom.toISOString().split('T')[0];
        if (reportDateTo) params.date_to = reportDateTo.toISOString().split('T')[0];
      } else {
        params.preset = reportPreset;
      }
      const resp = await api.get('/dashboard/export', { params, responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([resp.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_lubos_${reportPreset || 'custom'}.csv`;
      a.click();
      window.URL.revokeObjectURL(url);
      toast.success('Reporte exportado');
    } catch { toast.error('Error exportando'); }
  };

  const triggerImportClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleCsvImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const text = event.target.result;
        const { data } = await api.post('/dashboard/import-csv', { csvText: text });
        if (data.success) {
          toast.success(`Se importaron ${data.importedCount} pedidos correctamente.`);
          
          // Trigger data reload
          loadFast();
          loadSlow();
          loadReport();

          if (data.newCustomers && data.newCustomers.length > 0) {
            setImportedNewCustomers(data.newCustomers.map(c => ({ ...c, gender: null })));
            setShowImportCustomersDialog(true);
          }
        } else {
          toast.error('Error al importar el archivo CSV.');
        }
      } catch (err) {
        toast.error(err?.response?.data?.detail || 'Error al importar pedidos');
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    };
    reader.readAsText(file);
  };

  const saveImportGenders = async () => {
    setSavingImportGenders(true);
    try {
      await api.put('/customers/bulk-gender', { customers: importedNewCustomers });
      toast.success('Géneros de clientes actualizados correctamente.');
      setShowImportCustomersDialog(false);
      loadFast();
      loadSlow();
    } catch (err) {
      toast.error('Error al guardar géneros de clientes.');
    } finally {
      setSavingImportGenders(false);
    }
  };

  const handleImportGenderSelect = (customerId, gender) => {
    setImportedNewCustomers(prev =>
      prev.map(c => (c.id === customerId ? { ...c, gender } : c))
    );
  };

  const loadWidgetSettings = useCallback(async () => {
    try {
      const { data } = await api.get('/widget-settings');
      setWidgetSettings(data);
    } catch (e) { console.warn('[Admin] widget settings load failed:', e?.message || e); }
  }, []);

  useEffect(() => { if (activeSection === 'config' && configSubSection === 'widgets') loadWidgetSettings(); }, [activeSection, configSubSection, loadWidgetSettings]);

  const loadQuotes = useCallback(async () => {
    try { setQuotes((await api.get('/quotes')).data); }
    catch (e) { console.warn('[Admin] quotes load failed:', e?.message || e); }
  }, []);
  useEffect(() => { loadQuotes(); }, [loadQuotes]);

  const loadFinance = useCallback(async () => {
    setLoadingFinance(true);
    try {
      const { data } = await api.get('/finance/daily', { params: { date: financeDate } });
      setFinanceData(data);
    } catch (e) { toast.error('Error cargando finanzas'); console.warn('[Admin] finance load failed:', e?.message || e); }
    setLoadingFinance(false);
  }, [financeDate]);
  useEffect(() => {
    if (activeSection === 'finanzas') loadFinance();
  }, [activeSection, loadFinance]);

  // Top 5 historical days for Resumen
  const [topDays, setTopDays] = useState([]);
  const loadTopDays = useCallback(async () => {
    try {
      const { data } = await api.get('/dashboard/records');
      setTopDays(data.top_days || []);
    } catch (e) { console.warn('[Admin] top_days load failed:', e?.message || e); }
  }, []);
  useEffect(() => { if (activeSection === 'resumen') loadTopDays(); }, [activeSection, loadTopDays]);

  const deleteQuote = async (qid) => {
    if (!window.confirm('Eliminar esta cotizacion?')) return;
    try { await api.delete(`/quotes/${qid}`); toast.success('Cotizacion eliminada'); loadQuotes(); }
    catch { toast.error('Error'); }
  };

  // Stock movement actions
  const openStockDialog = async (flavor) => {
    setStockFlavor(flavor); setStockDelta(''); setStockDesc('');
    setStockMovements([]); setShowStockDialog(true);
    try {
      const { data } = await api.get(`/flavors/${flavor.id}/stock-movements`);
      setStockMovements(data);
    } catch (e) { console.warn('[Admin] movements load failed:', e?.message || e); }
  };
  const saveStockMovement = async () => {
    const delta = parseInt(stockDelta, 10);
    if (!delta || Number.isNaN(delta)) { toast.error('Cantidad debe ser distinta de 0'); return; }
    try {
      await api.post(`/flavors/${stockFlavor.id}/stock-movement`, { delta, description: stockDesc });
      toast.success(delta > 0 ? `+${delta} agregadas` : `${delta} descontadas`);
      setStockDelta(''); setStockDesc('');
      const { data } = await api.get(`/flavors/${stockFlavor.id}/stock-movements`);
      setStockMovements(data);
      loadAll();
    } catch (err) { toast.error(err.response?.data?.detail || 'Error'); }
  };

  const rate = settings.exchange_rate_ves || 36.5;

  // Flavor CRUD
  const openAddFlavor = () => { setEditingFlavor(null); setFlavorForm({ name: '', price_usd: '', available: true, stock: '', stock_unlimited: false, image: '' }); setShowFlavorDialog(true); };
  const openEditFlavor = (f) => { setEditingFlavor(f); setFlavorForm({ name: f.name, price_usd: String(f.price_usd), available: f.available, stock: String(f.stock || 0), stock_unlimited: !!f.stock_unlimited, image: f.image || '' }); setShowFlavorDialog(true); };
  const saveFlavor = async () => {
    if (!flavorForm.name || !flavorForm.price_usd) { toast.error('Completa los campos'); return; }
    const payload = {
      name: flavorForm.name,
      price_usd: parseFloat(flavorForm.price_usd),
      available: flavorForm.available,
      stock: parseInt(flavorForm.stock || 0),
      stock_unlimited: !!flavorForm.stock_unlimited,
      image: flavorForm.image || null,
    };
    const prevFlavors = [...flavors];
    const tempId = editingFlavor ? editingFlavor.id : `temp_${Date.now()}`;
    const newFlavor = { id: tempId, ...payload };

    // 0ms Optimistic UI update
    if (editingFlavor) {
      setFlavors(p => p.map(f => f.id === editingFlavor.id ? newFlavor : f));
      toast.success('Sabor actualizado');
    } else {
      setFlavors(p => [...p, newFlavor]);
      toast.success('Sabor creado');
    }
    setShowFlavorDialog(false);
    notifyLocalChange('flavors_changed', { self: true });

    try {
      if (editingFlavor) {
        await api.put(`/flavors/${editingFlavor.id}`, payload);
      } else {
        const res = await api.post('/flavors', payload);
        if (res.data?.id) {
          setFlavors(p => p.map(f => f.id === tempId ? res.data : f));
        }
      }
    } catch (err) {
      setFlavors(prevFlavors);
      toast.error(err.response?.data?.detail || 'Error al guardar sabor');
    }
  };
  const deleteFlavor = async (id) => {
    const prevFlavors = [...flavors];
    setFlavors(p => p.filter(f => f.id !== id));
    toast.success('Eliminado');
    notifyLocalChange('flavors_changed', { self: true });
    try {
      await api.delete(`/flavors/${id}`);
    } catch {
      setFlavors(prevFlavors);
      toast.error('Error al eliminar sabor');
    }
  };

  const moveFlavor = async (index, direction) => {
    const newList = [...flavors];
    const target = index + direction;
    if (target < 0 || target >= newList.length) return;
    [newList[index], newList[target]] = [newList[target], newList[index]];
    setFlavors(newList); // optimistic
    try {
      await api.post('/flavors/reorder', { order: newList.map(f => f.id) });
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error al reordenar');
      loadAll();
    }
  };

  const updateStatus = async (orderId, status) => {
    const prev = orders.find(o => o.id === orderId);
    const prevStatus = prev?.status;

    // 0ms Optimistic UI update
    applyOptimisticOrderUpdate(orderId, { status });
    if (prevStatus === 'sin_pagar' && status === 'pendiente') {
      playNotificationSound('new_sale'); // caja registradora instantanea
    }
    notifyLocalChange('orders_changed', { self: true });
    toast.success('Estado actualizado');

    try {
      await api.patch(`/orders/${orderId}/status`, { status });
    } catch (err) {
      clearOptimisticOrderUpdate(orderId);
      setOrders(p => p.map(o => o.id === orderId ? { ...o, status: prevStatus } : o));
      toast.error(err.response?.data?.detail || 'Error actualizando estado');
    }
  };

  // Resize and compress image to a square 256x256 base64 JPEG
  const handleFlavorImage = (file) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { toast.error('Imagen muy grande (max 8MB)'); return; }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const ratio = Math.min(img.width, img.height);
        const sx = (img.width - ratio) / 2;
        const sy = (img.height - ratio) / 2;
        ctx.drawImage(img, sx, sy, ratio, ratio, 0, 0, size, size);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        setFlavorForm(prev => ({ ...prev, image: dataUrl }));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  // User CRUD
  const openAddUser = () => { setEditingUser(null); setUserForm({ name: '', username: '', password: '', role: 'vendedor', color: '#501122' }); setShowUserDialog(true); };
  const openEditUser = (u) => { setEditingUser(u); setUserForm({ name: u.name, username: u.username, password: '', role: u.role, color: u.color || '#501122' }); setShowUserDialog(true); };
  const saveUser = async () => {
    if (!userForm.name || !userForm.username) { toast.error('Campos requeridos'); return; }
    if (!editingUser && !userForm.password) { toast.error('Contrasena requerida'); return; }

    const payload = { name: userForm.name, username: userForm.username, role: userForm.role, color: userForm.color || '#501122' };
    if (userForm.password) payload.password = userForm.password;

    const prevUsers = [...users];
    const tempId = editingUser ? editingUser.id : `temp_${Date.now()}`;
    const newUser = { id: tempId, name: userForm.name, username: userForm.username, role: userForm.role, color: userForm.color || '#501122' };

    // 0ms Optimistic UI update
    if (editingUser) {
      setUsers(p => p.map(u => u.id === editingUser.id ? { ...u, ...newUser } : u));
      toast.success('Actualizado');
    } else {
      setUsers(p => [...p, newUser]);
      toast.success('Creado');
    }
    setShowUserDialog(false);
    notifyLocalChange('users_changed', { self: true });

    try {
      if (editingUser) {
        await api.put(`/users/${editingUser.id}`, payload);
      } else {
        const res = await api.post('/users', { ...payload, password: userForm.password });
        if (res.data?.id) {
          setUsers(p => p.map(u => u.id === tempId ? res.data : u));
        }
      }
    } catch (err) {
      setUsers(prevUsers);
      toast.error(err.response?.data?.detail || 'Error al guardar usuario');
    }
  };
  const deleteUser = async (id) => {
    const prevUsers = [...users];
    setUsers(p => p.filter(u => u.id !== id));
    toast.success('Eliminado');
    notifyLocalChange('users_changed', { self: true });
    try {
      await api.delete(`/users/${id}`);
    } catch {
      setUsers(prevUsers);
      toast.error('Error al eliminar usuario');
    }
  };

  const updateUserPhoto = async (userId, file) => {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { toast.error('Imagen muy grande (max 6 MB)'); return; }
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 240, 0.85);
      await api.put(`/users/${userId}`, { photo_data_url: dataUrl });
      toast.success('Foto actualizada');
      loadAll();
      if (authUser?.id === userId) await refreshUser();
    } catch { toast.error('No se pudo subir la foto'); }
  };
  const clearUserPhoto = async (userId) => {
    try {
      await api.put(`/users/${userId}`, { photo_data_url: '' });
      toast.success('Foto eliminada');
      loadAll();
      if (authUser?.id === userId) await refreshUser();
    } catch { toast.error('Error'); }
  };

  // Client actions
  const openClientHistory = async (client) => {
    setSelectedClient(client); setClientHistory([]); setShowClientDialog(true); setLoadingHistory(true);
    try { setClientHistory((await api.get(`/customers/${client.id}/orders`)).data); } catch { setClientHistory([]); }
    setLoadingHistory(false);
  };
  const deleteClient = async (clientId) => {
    if (!window.confirm('Eliminar este cliente y todos sus pedidos?')) return;
    const prevStats = clientStats;
    if (clientStats && clientStats.customers) {
      setClientStats(p => p ? {
        ...p,
        customers: (p.customers || []).filter(c => c.id !== clientId),
        total_customers: Math.max(0, (p.total_customers || 1) - 1)
      } : p);
    }
    toast.success('Cliente eliminado');
    setShowClientDialog(false);

    try {
      await api.delete(`/customers/${clientId}`);
      notifyLocalChange('customers_changed');
      notifyLocalChange('orders_changed');
      loadClientStats();
    } catch (err) {
      setClientStats(prevStats);
      toast.error(err.response?.data?.detail || 'Error al eliminar cliente');
    }
  };

  // Customer create/edit
  const openCreateCustomer = () => {
    setEditingCustomer(null);
    setCustomerForm({ name: '', prefix: '+58', phone: '', gender: null });
    setShowCustomerForm(true);
  };
  const openEditCustomer = (c) => {
    const phone = c.phone || '';
    const match = phone.match(/^(\+\d{1,3})(.*)/);
    setEditingCustomer(c);
    setCustomerForm({
      name: c.name,
      prefix: match ? match[1] : '+58',
      phone: match ? match[2] : phone,
      gender: c.gender || null,
    });
    setShowCustomerForm(true);
    setShowClientDialog(false);
  };
  const saveCustomer = async () => {
    if (!customerForm.name || !customerForm.phone) { toast.error('Completa nombre y telefono'); return; }
    const fullPhone = `${customerForm.prefix}${customerForm.phone}`;
    const prevStats = clientStats;
    const tempId = editingCustomer ? editingCustomer.id : `temp_${Date.now()}`;
    const newCust = {
      id: tempId,
      name: customerForm.name,
      phone: fullPhone,
      gender: customerForm.gender,
      total_orders: editingCustomer?.total_orders || 0,
      total_spent: editingCustomer?.total_spent || 0
    };

    // 0ms Optimistic UI update
    if (clientStats && clientStats.customers) {
      if (editingCustomer) {
        setClientStats(p => p ? {
          ...p,
          customers: (p.customers || []).map(c => c.id === editingCustomer.id ? { ...c, ...newCust } : c)
        } : p);
        toast.success('Cliente actualizado');
      } else {
        setClientStats(p => p ? {
          ...p,
          customers: [newCust, ...(p.customers || []).filter(c => c.id !== tempId)],
          total_customers: (p.total_customers || 0) + 1
        } : p);
        toast.success('Cliente creado');
      }
    }
    setShowCustomerForm(false);

    try {
      if (editingCustomer) {
        await api.put(`/customers/${editingCustomer.id}`, { name: customerForm.name, phone: fullPhone, gender: customerForm.gender });
      } else {
        const { data } = await api.post('/customers', { name: customerForm.name, phone: fullPhone, gender: customerForm.gender });
        if (data && data.id) {
          setClientStats(p => p ? {
            ...p,
            customers: (p.customers || []).map(c => c.id === tempId ? { ...c, ...data } : c)
          } : p);
        }
      }
      notifyLocalChange('customers_changed', { self: true });
      loadClientStats();
    } catch (err) {
      setClientStats(prevStats);
      toast.error(err.response?.data?.detail || 'Error al guardar cliente');
    }
  };

  const cancelOrder = async (orderId) => {
    const prevOrder = orders.find(o => o.id === orderId);
    applyOptimisticOrderUpdate(orderId, { status: 'cancelado' });
    notifyLocalChange('orders_changed', { self: true });
    toast.success('Pedido cancelado');
    try {
      await api.patch(`/orders/${orderId}/status`, { status: 'cancelado' });
    } catch (err) {
      clearOptimisticOrderUpdate(orderId);
      if (prevOrder) setOrders(p => p.map(o => o.id === orderId ? prevOrder : o));
      toast.error(err.response?.data?.detail || 'Error al cancelar');
    }
  };

  const togglePrepared = async (orderId, prepared) => {
    // Optimistic update for instant UI feedback
    const target = orders.find(o => o.id === orderId);
    applyOptimisticOrderUpdate(orderId, { prepared, prepared_by_name: prepared ? (target?.prepared_by_name || 'Admin') : null });
    notifyLocalChange('orders_changed', { self: true });
    try {
      const res = await api.patch(`/orders/${orderId}/prepared`, { prepared });
      // Sync server fields (prepared_by_name, prepared_at)
      if (res.data) {
        applyOptimisticOrderUpdate(orderId, { ...res.data });
      }
    } catch (err) {
      clearOptimisticOrderUpdate(orderId);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, prepared: !prepared } : o));
      toast.error(err.response?.data?.detail || 'Error');
    }
  };

  const toggleWaitNotice = async (orderId, currentVal) => {
    const nextVal = !currentVal;
    applyOptimisticOrderUpdate(orderId, { wait_for_notice: nextVal });
    notifyLocalChange('orders_changed', { self: true });
    try {
      const res = await api.patch(`/orders/${orderId}/toggle-wait-notice`, { wait_for_notice: nextVal });
      if (res.data) {
        applyOptimisticOrderUpdate(orderId, { ...res.data });
      }
      toast.success(nextVal ? 'Pedido marcado como esperar aviso' : 'Esperar aviso desactivado');
    } catch (err) {
      clearOptimisticOrderUpdate(orderId);
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, wait_for_notice: currentVal } : o));
      toast.error(err.response?.data?.detail || 'Error cambiando estado');
    }
  };

  // Password-gated permanent deletion
  const [deletingOrderId, setDeletingOrderId] = useState(null);
  const confirmDeleteOrder = async () => {
    if (!deletingOrderId) return;
    const targetId = deletingOrderId;
    const targetOrder = orders.find(o => o.id === targetId);

    pendingOptimisticOrdersRef.current.set(targetId, { deleted: true, timestamp: Date.now() });
    setOrders(p => p.filter(o => o.id !== targetId));
    notifyLocalChange('orders_changed', { self: true });
    setDeletingOrderId(null);
    toast.success('Pedido eliminado');

    try {
      await api.delete(`/orders/${targetId}`);
    } catch (err) {
      clearOptimisticOrderUpdate(targetId);
      if (targetOrder) setOrders(p => [...p, targetOrder]);
      toast.error(err.response?.data?.detail || 'Error al eliminar');
    }
  };

  // Edit order
  const [editingOrder, setEditingOrder] = useState(null);

  // Unassign delivery (return to "Disponibles" pool)
  const unassignDelivery = async (orderId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    const newStatus = targetOrder?.status === 'en_camino' ? 'pendiente' : targetOrder?.status;
    const patch = { delivery_id: null, delivery_name: null, delivery_photo_url: null, status: newStatus };
    applyOptimisticOrderUpdate(orderId, patch);
    notifyLocalChange('orders_changed', { self: true });
    toast.success('Pedido devuelto a Disponibles');

    try {
      await api.post(`/orders/${orderId}/unassign-delivery`);
    } catch (err) {
      clearOptimisticOrderUpdate(orderId);
      if (targetOrder) setOrders(p => p.map(o => o.id === orderId ? targetOrder : o));
      toast.error(err.response?.data?.detail || 'Error');
    }
  };

  // Assign / reassign a delivery user on a pending order
  const assignDelivery = async (orderId, deliveryId) => {
    const targetOrder = orders.find(o => o.id === orderId);
    const delUser = users.find(u => u.id === deliveryId);
    const newStatus = targetOrder?.status === 'en_camino' ? 'pendiente' : targetOrder?.status;
    const patch = { delivery_id: deliveryId, delivery_name: delUser?.name || 'Delivery', delivery_photo_url: delUser?.photo_data_url || null, status: newStatus };
    applyOptimisticOrderUpdate(orderId, patch);
    notifyLocalChange('orders_changed', { self: true });
    toast.success('Delivery asignado');

    try {
      await api.post(`/orders/${orderId}/assign-delivery`, { delivery_id: deliveryId });
    } catch (err) {
      clearOptimisticOrderUpdate(orderId);
      if (targetOrder) setOrders(p => p.map(o => o.id === orderId ? targetOrder : o));
      toast.error(err.response?.data?.detail || 'Error al asignar');
    }
  };

  const formatDate = (iso) => iso ? new Date(iso).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  const navItems = isAdmin
    ? [
        { id: 'resumen', icon: LayoutDashboard, label: 'Resumen' },
        { id: 'pedidos', icon: ShoppingBag, label: 'Pedidos' },
        { id: 'nuevo-pedido', icon: PlusCircle, label: 'Nuevo' },
        { id: 'finanzas', icon: Wallet, label: 'Finanzas' },
        { id: 'clientes', icon: UserCheck, label: 'Clientes' },
        { id: 'config', icon: Settings, label: 'Config' },
      ]
    : [
        { id: 'clientes', icon: UserCheck, label: 'Clientes' },
        { id: 'nuevo-pedido', icon: PlusCircle, label: 'Nuevo' },
        { id: 'pedidos', icon: ShoppingBag, label: 'Pedidos' },
      ];

  const configTabs = [
    { id: 'general', icon: Settings, label: 'General' },
    { id: 'sabores', icon: IceCream2, label: 'Sabores' },
    { id: 'mapa', icon: MapPin, label: 'Mapa' },
    { id: 'equipo', icon: Users, label: 'Equipo' },
    { id: 'widgets', icon: Code2, label: 'Widgets' },
  ];

  const filteredClients = clientStats?.customers || [];

  // Memoized derived collections to avoid re-filtering on every render
  const safeOrdersList = Array.isArray(orders) ? orders : [];
  const unpaidOrders = useMemo(() => safeOrdersList.filter(o => o.status === 'sin_pagar'), [safeOrdersList]);
  const pendingPickups = useMemo(() => safeOrdersList.filter(o => o.order_type === 'pickup' && o.status === 'pendiente'), [safeOrdersList]);
  const availableFlavors = useMemo(() => flavors.filter(f => f.available), [flavors]);

  return (
    <div className={`pb-24 md:pb-6 transition-[padding] duration-200 ${sidebarCollapsed ? 'md:pl-[4.5rem]' : 'md:pl-[15rem]'}`}>
      <Sidebar items={navItems} activeId={activeSection} onSelect={setActiveSection} testIdPrefix="admin-tab" />
      <div className="min-w-0 space-y-5">

      {/* RESUMEN - PANEL DE ANÁLISIS MAESTRO */}
      {activeSection === 'resumen' && (
        <div className="space-y-6" data-testid="master-analytics-panel">
          {/* Header & Filter Bar */}
          <div className="bg-white rounded-[1.8rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-heading text-2xl text-[#501122]">Panel de Análisis Maestro</h2>
                  <span className="bg-[#3F634A]/10 text-[#3F634A] text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                    Visión 360°
                  </span>
                </div>
                <p className="text-xs text-[#78686C] mt-0.5">Métricas en tiempo real, ingresos, productos, horas pico y logística</p>
              </div>

              <div className="flex items-center gap-2">
                <Button onClick={exportReport} variant="outline" className="border-[#501122]/15 text-[#501122] hover:bg-[#501122]/5 rounded-full h-9 px-4 text-xs font-semibold" data-testid="export-btn">
                  <Download className="h-3.5 w-3.5 mr-1.5" />Exportar CSV
                </Button>
                <Button onClick={triggerImportClick} disabled={isImporting} variant="outline" className="border-[#3F634A]/15 text-[#3F634A] hover:bg-[#3F634A]/5 rounded-full h-9 px-4 text-xs font-semibold" data-testid="import-btn">
                  {isImporting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
                  Importar CSV
                </Button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleCsvImport}
                  accept=".csv"
                  className="hidden"
                />
                <Button onClick={loadReport} variant="outline" className="border-[#501122]/15 text-[#501122] hover:bg-[#501122]/5 rounded-full h-9 px-3 text-xs" data-testid="report-refresh-btn">
                  {loadingReport ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>

            {/* Presets & Custom Date Range */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#501122]/5">
              <div className="flex gap-1 bg-[#F0E4D8] rounded-full p-1 flex-wrap">
                {[
                  { id: 'today', label: 'Hoy' },
                  { id: 'yesterday', label: 'Ayer' },
                  { id: 'last7', label: 'Últimos 7 días' },
                  { id: 'this_week', label: 'Semana' },
                  { id: 'last_week', label: 'Semana pasada' },
                  { id: 'this_month', label: 'Mes Actual' },
                  { id: 'last_month', label: 'Mes Anterior' },
                  { id: 'custom', label: 'Personalizado' },
                ].map(p => (
                  <button key={p.id} onClick={() => setReportPreset(p.id)} data-testid={`report-preset-${p.id}`}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-300 ${reportPreset === p.id ? 'bg-[#501122] text-white shadow-sm' : 'text-[#78686C] hover:text-[#501122]'}`}>
                    {p.label}
                  </button>
                ))}
              </div>

              {reportPreset === 'custom' && (
                <div className="flex items-center gap-2">
                  <Popover><PopoverTrigger asChild><Button variant="outline" className="border-[#501122]/15 text-[#501122] rounded-full h-8 px-3 text-xs" data-testid="report-from-btn"><CalendarDays className="h-3.5 w-3.5 mr-1" />{reportDateFrom ? reportDateFrom.toLocaleDateString('es-VE') : 'Desde'}</Button></PopoverTrigger><PopoverContent className="w-auto p-0 rounded-2xl"><Calendar mode="single" selected={reportDateFrom} onSelect={setReportDateFrom} /></PopoverContent></Popover>
                  <Popover><PopoverTrigger asChild><Button variant="outline" className="border-[#501122]/15 text-[#501122] rounded-full h-8 px-3 text-xs" data-testid="report-to-btn"><CalendarDays className="h-3.5 w-3.5 mr-1" />{reportDateTo ? reportDateTo.toLocaleDateString('es-VE') : 'Hasta'}</Button></PopoverTrigger><PopoverContent className="w-auto p-0 rounded-2xl"><Calendar mode="single" selected={reportDateTo} onSelect={setReportDateTo} /></PopoverContent></Popover>
                  <Button onClick={loadReport} className="bg-[#501122] hover:bg-[#3D0C19] text-white rounded-full h-8 px-3 text-xs font-semibold" data-testid="report-apply-btn">Aplicar</Button>
                </div>
              )}
            </div>
          </div>

          {report && (
            <>
              {/* Primary KPI Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* 1. Total Revenue Card with Breakdown */}
                <div className={`bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`} data-testid="kpi-revenue-card">
                  {loadingReport ? (
                    <div className="space-y-4 py-1">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#501122]/5 shrink-0"></div>
                        <div className="space-y-2 flex-1">
                          <div className="h-3 bg-[#501122]/10 rounded w-1/2"></div>
                          <div className="h-6 bg-[#501122]/10 rounded w-3/4"></div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#501122]/5">
                        <div className="h-12 bg-[#501122]/5 rounded-xl"></div>
                        <div className="h-12 bg-[#501122]/5 rounded-xl"></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#3F634A] flex items-center justify-center shrink-0">
                          <DollarSign className="h-5 w-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Ingresos Totales</p>
                          <p className="font-heading text-2xl text-[#501122] font-bold" data-testid="kpi-total-revenue">{formatUSD(report.summary.total_revenue)}</p>
                          <p className="text-[10px] text-[#78686C] font-medium">{formatVES(report.summary.total_revenue, rate)}</p>
                        </div>
                      </div>
                      {(() => {
                        const driverPct = settings.delivery_driver_pct ?? 85;
                        const companyPct = 100 - driverPct;
                        const delRev = report.summary.delivery_revenue || 0;
                        return (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-[#501122]/5">
                            <div className="bg-[#C27A29]/10 rounded-xl p-2.5 text-center">
                              <p className="text-[9px] uppercase font-bold text-[#C27A29]">Venta Productos</p>
                              <p className="font-heading text-sm text-[#501122] font-bold">{formatUSD(report.summary.product_revenue || 0)}</p>
                            </div>
                            <div className="bg-[#3F634A]/10 rounded-xl p-2.5 text-center space-y-1">
                              <p className="text-[9px] uppercase font-bold text-[#3F634A]">Cobro Delivery Total</p>
                              <p className="font-heading text-sm text-[#501122] font-bold">{formatUSD(delRev)}</p>
                              <div className="flex justify-around items-center text-[10px] pt-1 border-t border-[#3F634A]/15 font-semibold">
                                <span className="text-[#3F634A]">Repartidores ({driverPct}%): <b>{formatUSD(delRev * (driverPct / 100))}</b></span>
                                <span className="text-[#501122]">Empresa ({companyPct}%): <b>{formatUSD(delRev * (companyPct / 100))}</b></span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>

                {/* 2. Total Orders & Success Rate */}
                <div className={`bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`} data-testid="kpi-orders-card">
                  {loadingReport ? (
                    <div className="space-y-4 py-1">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#501122]/5 shrink-0"></div>
                        <div className="space-y-2 flex-1">
                          <div className="h-3 bg-[#501122]/10 rounded w-1/2"></div>
                          <div className="h-6 bg-[#501122]/10 rounded w-3/4"></div>
                        </div>
                      </div>
                      <div className="h-8 bg-[#501122]/5 rounded-xl pt-2 border-t border-[#501122]/5"></div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#501122] flex items-center justify-center shrink-0">
                          <Package className="h-5 w-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Volumen de Pedidos</p>
                          <p className="font-heading text-2xl text-[#501122] font-bold">{report.summary.total_orders} <span className="text-xs font-normal text-[#78686C]">pedidos</span></p>
                          <p className="text-[10px] text-[#3F634A] font-semibold">{report.summary.total_delivered} entregados con éxito</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs pt-2 border-t border-[#501122]/5">
                        <span className="text-[#78686C]">Cancelaciones: <b className="text-red-600">{report.summary.total_cancelled} ({report.summary.cancellation_rate}%)</b></span>
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {(100 - (report.summary.cancellation_rate || 0)).toFixed(0)}% Efectivo
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* 3. Ticket Promedio */}
                <div className={`bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`} data-testid="kpi-ticket-card">
                  {loadingReport ? (
                    <div className="space-y-4 py-1">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#501122]/5 shrink-0"></div>
                        <div className="space-y-2 flex-1">
                          <div className="h-3 bg-[#501122]/10 rounded w-1/2"></div>
                          <div className="h-6 bg-[#501122]/10 rounded w-3/4"></div>
                        </div>
                      </div>
                      <div className="h-8 bg-[#501122]/5 rounded-xl pt-2 border-t border-[#501122]/5"></div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#C27A29] flex items-center justify-center shrink-0">
                          <Target className="h-5 w-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Ticket Promedio</p>
                          <p className="font-heading text-2xl text-[#501122] font-bold">{formatUSD(report.summary.avg_ticket)}</p>
                          <p className="text-[10px] text-[#78686C]">{formatVES(report.summary.avg_ticket, rate)} por venta</p>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-[#501122]/5 text-center">
                        <p className="text-[10px] text-[#78686C]">Promedio calculado sobre pedidos completados</p>
                      </div>
                    </>
                  )}
                </div>

                {/* 4. Clientes & Fidelización */}
                <div className={`bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`} data-testid="kpi-customers-card">
                  {loadingReport ? (
                    <div className="space-y-4 py-1">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#501122]/5 shrink-0"></div>
                        <div className="space-y-2 flex-1">
                          <div className="h-3 bg-[#501122]/10 rounded w-1/2"></div>
                          <div className="h-6 bg-[#501122]/10 rounded w-3/4"></div>
                        </div>
                      </div>
                      <div className="space-y-2 pt-2 border-t border-[#501122]/5">
                        <div className="h-3 bg-[#501122]/10 rounded w-full"></div>
                        <div className="h-3 bg-[#501122]/10 rounded w-5/6"></div>
                        <div className="h-3 bg-[#501122]/10 rounded w-4/5"></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-2xl bg-[#501122]/80 flex items-center justify-center shrink-0">
                          <Users className="h-5 w-5 text-white" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Clientes Únicos</p>
                          <p className="font-heading text-2xl text-[#501122] font-bold">{report.summary.unique_customers}</p>
                        </div>
                      </div>
                      <div className="space-y-1.5 pt-2 border-t border-[#501122]/5 text-xs text-[#78686C]">
                        <div className="flex justify-between items-center">
                          <span>Con 1 pedido:</span>
                          <span className="font-bold text-[#501122] bg-[#501122]/5 px-2 py-0.5 rounded-md">{report.summary.pct_1_order || 0}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Con 2 pedidos:</span>
                          <span className="font-bold text-[#501122] bg-[#501122]/5 px-2 py-0.5 rounded-md">{report.summary.pct_2_orders || 0}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Con 3 pedidos:</span>
                          <span className="font-bold text-[#501122] bg-[#501122]/5 px-2 py-0.5 rounded-md">{report.summary.pct_3_orders || 0}%</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span>Con 4+ pedidos:</span>
                          <span className="font-bold text-[#501122] bg-[#501122]/5 px-2 py-0.5 rounded-md">{report.summary.pct_4_plus_orders || 0}%</span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-dashed border-[#501122]/10 text-xs font-semibold">
                          <span className="text-[#78686C]">Total Recurrentes (&gt;1):</span>
                          <span className="text-white bg-[#501122] px-2.5 py-0.5 rounded-full text-[11px] font-bold" data-testid="recurrents-count">
                            {report.summary.repeat_customers || 0} ({report.summary.retention_rate || 0}%)
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Canales de Entrega */}
              <div className="w-full">
                {/* Pickup vs Delivery Card */}
                <div className={`bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`} data-testid="pickup-vs-delivery-card">
                  {loadingReport ? (
                    <div className="space-y-4">
                      {/* Header skeleton */}
                      <div className="space-y-2 mb-3">
                        <div className="h-5 bg-[#501122]/10 rounded w-1/3"></div>
                        <div className="h-3 bg-[#501122]/10 rounded w-1/4"></div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="h-24 bg-[#501122]/5 rounded-2xl"></div>
                        <div className="h-24 bg-[#501122]/5 rounded-2xl"></div>
                        <div className="h-24 bg-[#501122]/5 rounded-2xl"></div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <div className="h-3 bg-[#501122]/10 rounded w-1/4"></div>
                          <div className="h-3 bg-[#501122]/10 rounded w-1/4"></div>
                          <div className="h-3 bg-[#501122]/10 rounded w-1/4"></div>
                        </div>
                        <div className="h-3 bg-[#501122]/5 rounded-full w-full"></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-heading text-lg text-[#501122] flex items-center gap-2">
                            <ShoppingBag className="h-5 w-5 text-[#C27A29]" />Canales de Entrega (Pickup vs Tienda vs Delivery)
                          </p>
                          <p className="text-xs text-[#78686C]">Distribución de entregas completadas por canal</p>
                        </div>
                      </div>
                      {(() => {
                        const totalEntr = (report.summary.pickup_count || 0) + (report.summary.delivery_count || 0) + (report.summary.tienda_count || 0);
                        const pickPct = totalEntr > 0 ? Math.round((report.summary.pickup_count / totalEntr) * 100) : 0;
                        const tiendaPct = totalEntr > 0 ? Math.round((report.summary.tienda_count / totalEntr) * 100) : 0;
                        const delPct = totalEntr > 0 ? Math.max(0, 100 - pickPct - tiendaPct) : 0;
                        return (
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="bg-[#C27A29]/10 rounded-2xl p-4 border border-[#C27A29]/20" data-testid="pickup-stat">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs font-bold uppercase tracking-wider text-[#C27A29] flex items-center gap-1.5">
                                    <ShoppingBag className="h-4 w-4" />Pickup
                                  </span>
                                  <span className="text-xs font-bold text-[#C27A29] bg-[#C27A29]/15 px-2 py-0.5 rounded-full">{pickPct}%</span>
                                </div>
                                <p className="font-heading text-2xl text-[#501122] font-bold">{report.summary.pickup_count} <span className="text-xs text-[#78686C]">pedidos</span></p>
                                <p className="text-xs font-semibold text-[#501122] mt-1">Total: {formatUSD(report.summary.pickup_revenue || 0)}</p>
                              </div>

                              <div className="bg-emerald-500/10 rounded-2xl p-4 border border-emerald-500/20" data-testid="tienda-stat">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 flex items-center gap-1.5">
                                    <Store className="h-4 w-4" />Tienda
                                  </span>
                                  <span className="text-xs font-bold text-emerald-700 bg-emerald-500/15 px-2 py-0.5 rounded-full">{tiendaPct}%</span>
                                </div>
                                <p className="font-heading text-2xl text-[#501122] font-bold">{report.summary.tienda_count} <span className="text-xs text-[#78686C]">ventas</span></p>
                                <p className="text-xs font-semibold text-[#501122] mt-1">Total: {formatUSD(report.summary.tienda_revenue || 0)}</p>
                              </div>

                              <div className="bg-blue-600/10 rounded-2xl p-4 border border-blue-600/20" data-testid="delivery-stat">
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-xs font-bold uppercase tracking-wider text-blue-700 flex items-center gap-1.5">
                                    <Truck className="h-4 w-4" />Delivery
                                  </span>
                                  <span className="text-xs font-bold text-blue-700 bg-blue-600/15 px-2 py-0.5 rounded-full">{delPct}%</span>
                                </div>
                                <p className="font-heading text-2xl text-[#501122] font-bold">{report.summary.delivery_count} <span className="text-xs text-[#78686C]">pedidos</span></p>
                                <p className="text-xs font-semibold text-[#501122] mt-1">Total: {formatUSD(report.summary.delivery_orders_revenue || 0)}</p>
                              </div>
                            </div>

                            {/* Continuous Proportion Bar */}
                            <div>
                              <div className="flex justify-between text-xs font-semibold mb-1">
                                <span className="text-[#C27A29]">Pickup ({pickPct}%)</span>
                                <span className="text-emerald-700">Tienda ({tiendaPct}%)</span>
                                <span className="text-blue-700">Delivery ({delPct}%)</span>
                              </div>
                              <div className="flex h-3 rounded-full overflow-hidden bg-[#F0E4D8]">
                                <div className="bg-[#C27A29] transition-all duration-500" style={{ width: `${pickPct}%` }}></div>
                                <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${tiendaPct}%` }}></div>
                                <div className="bg-blue-600 transition-all duration-500" style={{ width: `${delPct}%` }}></div>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              </div>

              {/* Charts - Always Visible Labels (NO HOVER NEEDED) */}
              {/* Daily Sales Trend Chart */}
              {((report?.daily_chart && report.daily_chart.length > 0) || loadingReport) && (
                <div className={`bg-white rounded-[1.8rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-4 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`}>
                  {loadingReport ? (
                    <div className="space-y-4">
                      {/* Header skeleton */}
                      <div className="space-y-2">
                        <div className="h-5 bg-[#501122]/10 rounded w-1/3"></div>
                        <div className="h-3 bg-[#501122]/10 rounded w-1/2"></div>
                      </div>
                      {/* Simulated Chart Silhouette bars */}
                      <div className="flex items-end justify-between h-[240px] pt-10 px-4 border-b border-[#501122]/10">
                        <div className="w-[8%] bg-[#3F634A]/5 rounded-t-lg h-[20%]"></div>
                        <div className="w-[8%] bg-[#3F634A]/10 rounded-t-lg h-[45%]"></div>
                        <div className="w-[8%] bg-[#3F634A]/20 rounded-t-lg h-[70%]"></div>
                        <div className="w-[8%] bg-[#3F634A]/5 rounded-t-lg h-[30%]"></div>
                        <div className="w-[8%] bg-[#3F634A]/15 rounded-t-lg h-[85%]"></div>
                        <div className="w-[8%] bg-[#3F634A]/10 rounded-t-lg h-[60%]"></div>
                        <div className="w-[8%] bg-[#3F634A]/5 rounded-t-lg h-[40%]"></div>
                      </div>
                      {/* Legend skeleton */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 pt-3 border-t border-[#501122]/5 text-center">
                        {[...Array(7)].map((_, i) => (
                          <div key={i} className="bg-[#F3EBE0]/30 rounded-xl p-2 space-y-1.5">
                            <div className="h-2.5 bg-[#501122]/10 rounded mx-auto w-2/3"></div>
                            <div className="h-4 bg-[#501122]/10 rounded mx-auto w-1/2"></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-heading text-xl text-[#501122] flex items-center gap-2">
                            <TrendingUp className="h-5 w-5 text-[#3F634A]" />Evolución de Ingresos por Día ($)
                          </p>
                          <p className="text-xs text-[#78686C]">Monto recaudado cada día. Los montos se muestran permanentemente en las barras.</p>
                        </div>
                        <span className="bg-[#3F634A]/10 text-[#3F634A] text-xs font-bold px-3 py-1 rounded-full">
                          Valores Continuos Imprimidos
                        </span>
                      </div>

                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={report?.daily_chart || []} margin={{ top: 25, right: 10, left: 10, bottom: 5 }}>
                          <XAxis dataKey="date" tick={{ fill: '#501122', fontSize: 11, fontWeight: 600 }} tickFormatter={v => {
                            const parts = (v || '').split('-');
                            return parts.length === 3 ? `${parts[2]}/${parts[1]}` : (v || '');
                          }} axisLine={{ stroke: '#501122', strokeOpacity: 0.1 }} tickLine={false} />
                          <YAxis tick={{ fill: '#78686C', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                          <Bar dataKey="revenue" fill="#3F634A" radius={[10, 10, 0, 0]} name="Ingresos USD">
                            <LabelList dataKey="revenue" position="top" formatter={(v) => typeof v === 'number' && v > 0 ? `$${v.toFixed(0)}` : ''} style={{ fill: '#3F634A', fontSize: 12, fontWeight: 700, fontFamily: 'Outfit' }} />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>

                      {/* Explicit Permanent Legend List */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2 pt-3 border-t border-[#501122]/5 text-center">
                        {(report?.daily_chart || []).map(item => (
                          <div key={item.date} className="bg-[#F3EBE0]/60 rounded-xl p-2">
                            <p className="text-[10px] font-bold text-[#78686C] uppercase">{(item.date || '').slice(5)}</p>
                            <p className="font-heading text-sm text-[#3F634A] font-bold">{formatUSD(item.revenue)}</p>
                            <p className="text-[9px] text-[#501122]">{item.orders} ped.</p>
                            <p className="font-heading text-sm text-[#3F634A] font-bold">{formatUSD(item.revenue)}</p>
                            <p className="text-[9px] text-[#501122]">{item.orders} ped.</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Peak Hours & Orders per Day (2 Columns) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Orders per day chart */}
                {(report.daily_chart.length > 0 || loadingReport) && (
                  <div className={`bg-white rounded-[1.8rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`}>
                    {loadingReport ? (
                      <div className="space-y-4">
                        {/* Header skeleton */}
                        <div className="space-y-2">
                          <div className="h-5 bg-[#501122]/10 rounded w-1/2"></div>
                          <div className="h-3 bg-[#501122]/10 rounded w-2/3"></div>
                        </div>
                        <div className="flex items-end justify-between h-[210px] pt-10 px-4 border-b border-[#501122]/10">
                          <div className="w-[10%] bg-[#501122]/5 rounded-t-lg h-[40%]"></div>
                          <div className="w-[10%] bg-[#501122]/15 rounded-t-lg h-[75%]"></div>
                          <div className="w-[10%] bg-[#501122]/10 rounded-t-lg h-[50%]"></div>
                          <div className="w-[10%] bg-[#501122]/20 rounded-t-lg h-[90%]"></div>
                          <div className="w-[10%] bg-[#501122]/5 rounded-t-lg h-[30%]"></div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="font-heading text-lg text-[#501122] flex items-center gap-2">
                          <Package className="h-5 w-5 text-[#501122]" />Cantidad de Pedidos por Día
                        </p>
                        <p className="text-xs text-[#78686C]">Número de órdenes atendidas diariamente (etiquetas siempre visibles)</p>
                        <ResponsiveContainer width="100%" height={210}>
                          <BarChart data={report.daily_chart} margin={{ top: 25, right: 10, left: 10, bottom: 5 }}>
                            <XAxis dataKey="date" tick={{ fill: '#501122', fontSize: 10, fontWeight: 600 }} tickFormatter={v => v.slice(5)} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#78686C', fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                            <Bar dataKey="orders" fill="#501122" radius={[8, 8, 0, 0]} name="Pedidos">
                              <LabelList dataKey="orders" position="top" formatter={(v) => v > 0 ? `${v}` : ''} style={{ fill: '#501122', fontSize: 12, fontWeight: 700, fontFamily: 'Outfit' }} />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </>
                    )}
                  </div>
                )}

                {/* Peak Hours Distribution */}
                {(report.peak_hours.some(h => h.orders > 0) || loadingReport) && (
                  <div className={`bg-white rounded-[1.8rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`}>
                    {loadingReport ? (
                      <div className="space-y-4">
                        {/* Header skeleton */}
                        <div className="space-y-2">
                          <div className="h-5 bg-[#501122]/10 rounded w-1/2"></div>
                          <div className="h-3 bg-[#501122]/10 rounded w-2/3"></div>
                        </div>
                        <div className="flex items-end justify-between h-[210px] pt-10 px-4 border-b border-[#501122]/10">
                          <div className="w-[6%] bg-[#C27A29]/5 rounded-t h-[15%]"></div>
                          <div className="w-[6%] bg-[#C27A29]/5 rounded-t h-[30%]"></div>
                          <div className="w-[6%] bg-[#C27A29]/15 rounded-t h-[65%]"></div>
                          <div className="w-[6%] bg-[#C27A29]/10 rounded-t h-[80%]"></div>
                          <div className="w-[6%] bg-[#C27A29]/5 rounded-t h-[40%]"></div>
                          <div className="w-[6%] bg-[#C27A29]/20 rounded-t h-[95%]"></div>
                          <div className="w-[6%] bg-[#C27A29]/5 rounded-t h-[50%]"></div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-heading text-lg text-[#501122] flex items-center gap-2">
                              <Clock className="h-5 w-5 text-[#C27A29]" />Horas Pico de Pedidos
                            </p>
                            <p className="text-xs text-[#78686C]">Distribución horaria con conteo visible en cada barra</p>
                          </div>
                          <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2.5 py-1 rounded-full">
                            {report.peak_hour}
                          </span>
                        </div>

                        <ResponsiveContainer width="100%" height={210}>
                          <BarChart data={report.peak_hours.filter((_, i) => i >= 8 && i <= 22)} margin={{ top: 25, right: 5, left: 5, bottom: 5 }}>
                            <XAxis dataKey="hour" tick={{ fill: '#78686C', fontSize: 9 }} tickFormatter={v => v.replace(':00', 'h')} axisLine={false} tickLine={false} />
                            <YAxis tick={{ fill: '#78686C', fontSize: 10 }} allowDecimals={false} axisLine={false} tickLine={false} />
                            <Bar dataKey="orders" fill="#C27A29" radius={[8, 8, 0, 0]} name="Pedidos">
                              <LabelList dataKey="orders" position="top" formatter={(v) => v > 0 ? v : ''} style={{ fill: '#C27A29', fontSize: 11, fontWeight: 700, fontFamily: 'Outfit' }} />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Top Flavors + Status Breakdown Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Top Flavors */}
                {(report.top_flavors.length > 0 || loadingReport) && (
                  <div className={`bg-white rounded-[1.8rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-4 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`}>
                    {loadingReport ? (
                      <div className="space-y-4">
                        {/* Header skeleton */}
                        <div className="space-y-2">
                          <div className="h-5 bg-[#501122]/10 rounded w-1/3"></div>
                          <div className="h-3 bg-[#501122]/10 rounded w-1/2"></div>
                        </div>
                        <div className="space-y-4 pt-2">
                          {[1, 2, 3, 4].map((i) => (
                            <div key={i} className="space-y-2">
                              <div className="flex justify-between items-center">
                                <div className="h-3.5 bg-[#501122]/10 rounded w-1/3"></div>
                                <div className="h-3.5 bg-[#501122]/10 rounded w-1/4"></div>
                              </div>
                              <div className="h-2.5 bg-[#501122]/5 rounded-full w-full"></div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="font-heading text-lg text-[#501122] flex items-center gap-2">
                            <IceCream2 className="h-5 w-5 text-[#501122]" />Sabores Más Vendidos
                          </p>
                          <p className="text-xs text-[#78686C]">Porciones vendidas, % de cuota e ingresos generados</p>
                        </div>

                        <div className="space-y-3">
                          {report.top_flavors.map((f, i) => (
                            <div key={f.name} className="space-y-1">
                              <div className="flex items-center justify-between text-xs font-semibold">
                                <span className="text-[#501122] flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full bg-[#501122]/10 text-[#501122] text-[10px] flex items-center justify-center font-bold">{i + 1}</span>
                                  {f.name}
                                </span>
                                <span className="text-[#3F634A] font-bold">
                                  {f.quantity} porciones &middot; {formatUSD(f.revenue || 0)} ({f.percentage}%)
                                </span>
                              </div>
                              <div className="h-2.5 w-full bg-[#F0E4D8] rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${f.percentage}%`, backgroundColor: f.color || '#501122' }}></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Status Breakdown (Donut + Static Legend Grid) */}
                {(report.status_breakdown.length > 0 || loadingReport) && (
                  <div className={`bg-white rounded-[1.8rem] border border-[#501122]/10 p-6 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-4 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`}>
                    {loadingReport ? (
                      <div className="space-y-4">
                        {/* Header skeleton */}
                        <div className="space-y-2">
                          <div className="h-5 bg-[#501122]/10 rounded w-1/3"></div>
                          <div className="h-3 bg-[#501122]/10 rounded w-1/2"></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4 pt-2">
                          <div className="relative w-36 h-36 mx-auto rounded-full border-[10px] border-[#3F634A]/10 flex items-center justify-center">
                            <div className="w-20 h-20 rounded-full bg-white border border-[#3F634A]/5"></div>
                          </div>
                          <div className="space-y-2.5">
                            {[1, 2, 3, 4].map((i) => (
                              <div key={i} className="flex justify-between items-center bg-[#F3EBE0]/30 p-2.5 rounded-xl border border-[#501122]/5">
                                <div className="h-3 bg-[#501122]/10 rounded w-1/2"></div>
                                <div className="h-3 bg-[#501122]/15 rounded w-1/6"></div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div>
                          <p className="font-heading text-lg text-[#501122] flex items-center gap-2">
                            <PackageCheck className="h-5 w-5 text-[#3F634A]" />Estado de los Pedidos
                          </p>
                          <p className="text-xs text-[#78686C]">Distribución por estado actual (todas las cifras expuestas)</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 items-center gap-4">
                          <ResponsiveContainer width="100%" height={170}>
                            <PieChart>
                              <Pie data={report.status_breakdown} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={42} outerRadius={70} paddingAngle={4}>
                                {report.status_breakdown.map((s) => <Cell key={s.status} fill={s.color || '#501122'} />)}
                              </Pie>
                            </PieChart>
                          </ResponsiveContainer>

                          {/* Always Visible Legend Table */}
                          <div className="space-y-2">
                            {report.status_breakdown.map((s) => (
                              <div key={s.status} className="flex items-center justify-between bg-[#F3EBE0]/50 p-2 rounded-xl border border-[#501122]/5 text-xs">
                                <div className="flex items-center gap-2">
                                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color || '#501122' }}></span>
                                  <span className="font-semibold text-[#501122]">{s.label || statusLabels[s.status] || s.status}</span>
                                </div>
                                <span className="font-heading text-sm text-[#501122] font-bold">
                                  {s.count} <span className="text-[10px] text-[#78686C]">({s.percentage}%)</span>
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Top Customers + Delivery Performance */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Top Customers */}
                {(report.top_customers.length > 0 || loadingReport) && (
                  <div className={`bg-white rounded-[1.8rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`}>
                    {loadingReport ? (
                      <div className="space-y-3">
                        {/* Header skeleton */}
                        <div className="h-5 bg-[#501122]/10 rounded w-1/2"></div>
                        <div className="space-y-2 pt-2">
                          {[1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center gap-3 p-2.5 rounded-2xl bg-[#F3EBE0]/30 border border-[#501122]/5">
                              <span className="w-8 h-8 rounded-full bg-[#501122]/10 shrink-0"></span>
                              <div className="flex-1 space-y-1.5 min-w-0">
                                <div className="h-3.5 bg-[#501122]/10 rounded w-1/2"></div>
                                <div className="h-2.5 bg-[#501122]/10 rounded w-2/3"></div>
                              </div>
                              <div className="space-y-1.5">
                                <div className="h-4 bg-[#3F634A]/10 rounded w-12 ml-auto"></div>
                                <div className="h-2.5 bg-[#501122]/10 rounded w-16 ml-auto"></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="font-heading text-lg text-[#501122] flex items-center gap-2"><Award className="h-5 w-5 text-amber-600" />Top Clientes del Período</p>
                        <div className="space-y-2">
                          {report.top_customers.map((c, i) => (
                            <div key={c.id || c.name} className="flex items-center gap-3 p-2.5 rounded-2xl bg-[#F3EBE0]/40 border border-[#501122]/5">
                              <span className="w-8 h-8 rounded-full bg-[#501122] text-white flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-[#501122] text-sm truncate">{c.name}</p>
                                <p className="text-[10px] text-[#78686C]">{c.orders} pedidos realizdos &middot; {c.phone}</p>
                              </div>
                              <div className="text-right">
                                <p className="font-heading text-base text-[#3F634A] font-bold">{formatUSD(c.revenue)}</p>
                                <p className="text-[9px] text-[#78686C]">{formatVES(c.revenue, rate)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Delivery Driver Performance */}
                {(report.delivery_ranking.length > 0 || loadingReport) && (
                  <div className={`bg-white rounded-[1.8rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`} data-testid="delivery-ranking-card">
                    {loadingReport ? (
                      <div className="space-y-4">
                        {/* Header skeleton */}
                        <div className="flex items-center justify-between gap-3">
                          <div className="h-5 bg-[#501122]/10 rounded w-1/2"></div>
                          <div className="h-5 bg-[#3F634A]/10 rounded-full w-1/3"></div>
                        </div>
                        <div className="space-y-2.5 pt-2">
                          {[1, 2].map((i) => (
                            <div key={i} className="p-3 rounded-2xl bg-[#F3EBE0]/30 border border-[#501122]/5 space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-9 h-9 rounded-full bg-[#3F634A]/10 shrink-0"></div>
                                  <div className="space-y-1.5 flex-1 min-w-0">
                                    <div className="h-3.5 bg-[#501122]/10 rounded w-24"></div>
                                    <div className="h-2.5 bg-[#501122]/10 rounded w-36"></div>
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <div className="h-2.5 bg-[#78686C]/10 rounded w-10 ml-auto"></div>
                                  <div className="h-4 bg-[#3F634A]/10 rounded w-14 ml-auto"></div>
                                </div>
                              </div>
                              <div className="flex items-center justify-between pt-2 border-t border-[#501122]/5">
                                <div className="h-3 bg-[#501122]/10 rounded w-1/3"></div>
                                <div className="h-3 bg-[#501122]/10 rounded w-1/4"></div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <>
                        {(() => {
                          const totalEarn = report.delivery_ranking.reduce((s, d) => s + (d.earnings || 0), 0);
                          const totalDel = report.delivery_ranking.reduce((s, d) => s + (d.delivered || 0), 0);
                          return (
                            <div className="flex items-center justify-between gap-3">
                              <p className="font-heading text-lg text-[#501122] flex items-center gap-2"><Truck className="h-5 w-5 text-[#3F634A]" />Rendimiento Repartidores</p>
                              <div className="text-right" data-testid="delivery-ranking-total">
                                <span className="text-xs font-bold text-[#3F634A] bg-[#3F634A]/10 px-2.5 py-1 rounded-full">
                                  Ganado: {formatUSD(totalEarn)} ({totalDel} entregas)
                                </span>
                              </div>
                            </div>
                          );
                        })()}

                        <div className="space-y-2.5">
                          {report.delivery_ranking.map((d, i) => (
                            <div key={d.id || d.name} className="p-3 rounded-2xl bg-[#F3EBE0]/40 border border-[#501122]/5 space-y-2" data-testid={`delivery-row-${i}`}>
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2.5">
                                  <div className="w-9 h-9 rounded-full bg-[#3F634A] text-white flex items-center justify-center font-heading font-bold text-xs">
                                    {(d.name || '?')[0]}
                                  </div>
                                  <div>
                                    <p className="font-bold text-[#501122] text-sm">{d.name}</p>
                                    <p className="text-[10px] text-[#78686C]">{d.delivered}/{d.total} entregados exitosos ({d.success_rate || Math.round(d.delivered / (d.total || 1) * 100)}%)</p>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <p className="text-[9px] uppercase tracking-wider text-[#78686C] font-semibold">Ganancia</p>
                                  <p className="font-heading text-base text-[#3F634A] font-bold" data-testid={`delivery-earnings-${i}`}>{formatUSD(d.earnings || 0)}</p>
                                </div>
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-[#78686C] pt-2 border-t border-[#501122]/5">
                                <span>Ventas generadas: <b className="text-[#501122]">{formatUSD(d.revenue)}</b></span>
                                <span data-testid={`delivery-km-${i}`}>Distancia recorrida: <b className="text-[#501122]">{(d.km_delivered || 0).toFixed(1)} km</b></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Customer Loyalty Cohorts */}
              {(report.customer_cohorts || loadingReport) && (
                <div className={`bg-white rounded-[1.8rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`}>
                  {loadingReport ? (
                    <div className="space-y-4">
                      {/* Header skeleton */}
                      <div className="space-y-2">
                        <div className="h-5 bg-[#501122]/10 rounded w-1/3"></div>
                        <div className="h-3 bg-[#501122]/10 rounded w-1/2"></div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                        <div className="h-24 bg-[#3F634A]/5 rounded-2xl animate-pulse"></div>
                        <div className="h-24 bg-[#C27A29]/5 rounded-2xl animate-pulse"></div>
                        <div className="h-24 bg-[#501122]/5 rounded-2xl animate-pulse"></div>
                        <div className="h-24 bg-amber-100/20 rounded-2xl animate-pulse"></div>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="font-heading text-lg text-[#501122] flex items-center gap-2">
                        <Repeat className="h-5 w-5 text-[#3F634A]" />Fidelización y Frecuencia de Compra
                      </p>
                      <p className="text-xs text-[#78686C]">Análisis de recompras, cohorte de clientes y valor promedio de vida (LTV)</p>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-[#3F634A]/10 rounded-2xl p-3.5 border border-[#3F634A]/20">
                          <p className="text-[10px] uppercase font-bold text-[#3F634A]">Clientes Recurrentes</p>
                          <p className="font-heading text-2xl text-[#501122] font-bold">{report.customer_cohorts.repeat_count}</p>
                          <p className="text-[10px] text-[#78686C] mt-0.5">Tasa de retención: {report.customer_cohorts.retention_rate}%</p>
                        </div>

                        <div className="bg-[#C27A29]/10 rounded-2xl p-3.5 border border-[#C27A29]/20">
                          <p className="text-[10px] uppercase font-bold text-[#C27A29]">Frecuencia de Recompra</p>
                          <p className="font-heading text-2xl text-[#501122] font-bold">Cada {report.customer_cohorts.avg_days_between_orders} días</p>
                          <p className="text-[10px] text-[#78686C] mt-0.5">Intervalo prom. entre pedidos</p>
                        </div>

                        <div className="bg-[#501122]/10 rounded-2xl p-3.5 border border-[#501122]/20">
                          <p className="text-[10px] uppercase font-bold text-[#501122]">LTV Promedio Cliente</p>
                          <p className="font-heading text-xl text-[#501122] font-bold">{formatUSD(report.customer_cohorts.avg_customer_ltv)}</p>
                          <p className="text-[10px] text-[#78686C] mt-0.5">Facturación histórica/cliente</p>
                        </div>

                        <div className="bg-amber-100/60 rounded-2xl p-3.5 border border-amber-200">
                          <p className="text-[10px] uppercase font-bold text-amber-900">Clientes VIP (&gt;3 Pedidos)</p>
                          <p className="font-heading text-2xl text-amber-900 font-bold">{report.customer_cohorts.vip_customers_count}</p>
                          <p className="text-[10px] text-amber-800 mt-0.5">Clientes de alto valor constante</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* Top 5 Historical Days & Records */}
          {topDays.length > 0 && (
            <div className={`bg-white rounded-[1.8rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] space-y-3 transition-all duration-300 ${loadingReport ? 'shimmer-loading glow-card-loading' : ''}`} data-testid="top-days-card">
              {loadingReport ? (
                <div className="space-y-4">
                  {/* Header skeleton */}
                  <div className="flex items-center justify-between">
                    <div className="h-5 bg-[#501122]/10 rounded w-1/2"></div>
                    <div className="h-3.5 bg-[#78686C]/10 rounded w-20"></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5 pt-2">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="bg-[#F3EBE0]/30 rounded-2xl p-4 border border-[#501122]/5 text-center space-y-2 animate-pulse">
                        <div className="h-4 bg-[#501122]/10 rounded w-3/4 mx-auto"></div>
                        <div className="h-6 bg-[#3F634A]/10 rounded w-1/2 mx-auto"></div>
                        <div className="h-2.5 bg-[#78686C]/10 rounded w-2/3 mx-auto"></div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="font-heading text-lg text-[#501122] flex items-center gap-2"><Award className="h-5 w-5 text-amber-500" />Récords Históricos (Top 5 Mejores Días)</p>
                    <span className="text-xs font-semibold text-[#78686C]">Facturación histórica</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
                    {topDays.map((d, i) => {
                      const dateObj = new Date(`${d.date}T12:00:00`);
                      const label = dateObj.toLocaleDateString('es-VE', { timeZone: 'America/Caracas', weekday: 'short', day: 'numeric', month: 'short' });
                      const medals = ['bg-amber-400 text-amber-950', 'bg-slate-300 text-slate-900', 'bg-amber-700 text-white', 'bg-[#501122] text-white', 'bg-[#501122] text-white'];
                      return (
                        <div key={d.date} className="bg-[#F3EBE0]/60 rounded-2xl p-3 border border-[#501122]/5 text-center space-y-1" data-testid={`top-day-${i + 1}`}>
                          <div className="flex items-center justify-center gap-1.5">
                            <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${medals[i]}`}>#{i + 1}</span>
                            <span className="text-xs font-bold text-[#501122] capitalize">{label}</span>
                          </div>
                          <p className="font-heading text-lg text-[#3F634A] font-bold">{formatUSD(d.total)}</p>
                          <p className="text-[9px] text-[#78686C]">{formatVES(d.total, rate)}</p>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {!report && !loadingReport && <p className="text-center py-20 text-[#78686C]">Selecciona un periodo para ver el reporte</p>}
        </div>
      )}

      {/* FINANZAS */}
      {activeSection === 'finanzas' && (
        <div className="space-y-5" data-testid="finance-section">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-heading text-2xl text-[#501122] flex items-center gap-2"><Wallet className="h-6 w-6" />Cierre de Caja</h2>
              <p className="text-xs text-[#78686C] mt-1">Resumen de ingresos del dia y pagos pendientes a deliverys</p>
            </div>
            <div className="flex items-center gap-2">
              <Input type="date" value={financeDate} onChange={(e) => setFinanceDate(e.target.value)}
                className="bg-white border-[#501122]/15 h-10 rounded-2xl px-3 text-sm" data-testid="finance-date-input" />
              <Button variant="outline" size="sm" onClick={loadFinance} disabled={loadingFinance}
                className="border-[#501122]/15 text-[#501122] rounded-full h-10 px-4" data-testid="finance-refresh-btn">
                {loadingFinance ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          {loadingFinance && !financeData ? (
            <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-[#501122]" /></div>
          ) : !financeData ? (
            <p className="text-center py-20 text-[#78686C]">Sin datos</p>
          ) : (
            <>
              {/* Top KPI Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-[#501122] rounded-[1.5rem] p-5 shadow-[0_8px_30px_rgba(80,17,34,0.12)]" data-testid="finance-total-card">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/40">Facturacion total</p>
                  <p className="font-heading text-4xl text-white mt-2">{formatUSD(financeData.totals.revenue_total)}</p>
                  <p className="text-xs text-white/60 mt-1">{formatVES(financeData.totals.revenue_total, rate)}</p>
                </div>
                <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]" data-testid="finance-products-card">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-[#3F634A] flex items-center justify-center"><IceCream2 className="h-5 w-5 text-white" /></div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Productos</p>
                  </div>
                  <p className="font-heading text-3xl text-[#501122]">{formatUSD(financeData.totals.revenue_products)}</p>
                  <p className="text-[10px] text-[#78686C] mt-1">Sin contar delivery</p>
                </div>
                <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]" data-testid="finance-delivery-card">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-[#4285F4] flex items-center justify-center"><Truck className="h-5 w-5 text-white" /></div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Total Delivery</p>
                  </div>
                  <p className="font-heading text-3xl text-[#501122]">{formatUSD(financeData.totals.revenue_delivery)}</p>
                  <p className="text-[10px] text-[#78686C] mt-1">Cobrado a clientes</p>
                </div>
              </div>

              {/* Sub-stats row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-white rounded-2xl border border-[#501122]/10 p-3 text-center">
                  <p className="font-heading text-xl text-[#501122]">{financeData.summary_orders.paid_today}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#78686C] mt-0.5">Pedidos pagados</p>
                </div>
                <div className="bg-white rounded-2xl border border-[#501122]/10 p-3 text-center">
                  <p className="font-heading text-xl text-[#3F634A]">{financeData.summary_orders.delivered_today}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#78686C] mt-0.5">Entregados</p>
                </div>
                <div className="bg-white rounded-2xl border border-[#501122]/10 p-3 text-center">
                  <p className="font-heading text-xl text-red-500">{financeData.summary_orders.cancelled_today}</p>
                  <p className="text-[9px] font-semibold uppercase tracking-wider text-[#78686C] mt-0.5">Cancelados</p>
                </div>
              </div>

              {/* Flavors breakdown */}
              <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]" data-testid="finance-flavors-card">
                <p className="font-heading text-lg text-[#501122] mb-3 flex items-center gap-2"><IceCream2 className="h-5 w-5" />Ventas por Sabor</p>
                {financeData.flavors.length === 0 ? (
                  <p className="text-center py-6 text-[#78686C] text-sm">Sin ventas hoy</p>
                ) : (
                  <div className="space-y-2">
                    {financeData.flavors.map(f => (
                      <div key={f.id} className="flex items-center justify-between gap-3 py-2 border-b border-[#501122]/5 last:border-0" data-testid={`finance-flavor-${f.id}`}>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[#501122] text-sm truncate">{f.name}</p>
                          <p className="text-[11px] text-[#78686C]">{f.quantity} {f.quantity === 1 ? 'porcion' : 'porciones'}</p>
                        </div>
                        <p className="font-heading text-lg text-[#3F634A] shrink-0">{formatUSD(f.revenue)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Delivery payouts */}
              <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]" data-testid="finance-deliveries-card">
                <p className="font-heading text-lg text-[#501122] mb-1 flex items-center gap-2"><Truck className="h-5 w-5" />Pagos a Deliverys</p>
                <p className="text-[11px] text-[#78686C] mb-4">Ganan el dia que entregan. Los pendientes son pedidos pagados aun no entregados.</p>
                {(() => {
                  const totalEarned = financeData.deliveries.reduce((s, d) => s + (d.earned || 0), 0);
                  const totalDelivered = financeData.deliveries.reduce((s, d) => s + (d.delivered_count || 0), 0);
                  const totalPending = financeData.deliveries.reduce((s, d) => s + (d.pending_amount || 0), 0) + (financeData.pending_unassigned?.amount || 0);
                  return (
                    <div className="grid grid-cols-2 gap-3 mb-4">
                      <div className="bg-[#3F634A]/10 border border-[#3F634A]/20 rounded-2xl p-3" data-testid="finance-deliveries-total-earned">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#3F634A]">Total ganado hoy</p>
                        <p className="font-heading text-2xl text-[#3F634A] mt-1">{formatUSD(totalEarned)}</p>
                        <p className="text-[10px] text-[#78686C] mt-0.5">{totalDelivered} entregas en total</p>
                      </div>
                      <div className="bg-[#C27A29]/10 border border-[#C27A29]/20 rounded-2xl p-3" data-testid="finance-deliveries-total-pending">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#C27A29]">Por pagar (pendiente)</p>
                        <p className="font-heading text-2xl text-[#C27A29] mt-1">{formatUSD(totalPending)}</p>
                        <p className="text-[10px] text-[#78686C] mt-0.5">{financeData.deliveries.reduce((s, d) => s + (d.pending_count || 0), 0) + (financeData.pending_unassigned?.count || 0)} pedidos sin entregar</p>
                      </div>
                    </div>
                  );
                })()}
                {financeData.deliveries.length === 0 && financeData.pending_unassigned.count === 0 ? (
                  <p className="text-center py-6 text-[#78686C] text-sm">Sin movimientos hoy</p>
                ) : (
                  <div className="space-y-2">
                    {financeData.deliveries.map(d => {
                      const isOpen = expandedFinanceDelivery === d.id;
                      return (
                      <div key={d.id} className="border-b border-[#501122]/5 last:border-0" data-testid={`finance-delivery-${d.id}`}>
                        <button type="button" onClick={() => setExpandedFinanceDelivery(isOpen ? null : d.id)}
                          className="w-full flex items-center justify-between gap-3 py-3 text-left active:bg-[#F3EBE0]/30 transition-colors rounded-xl"
                          data-testid={`finance-delivery-toggle-${d.id}`}>
                          <div className="min-w-0 flex-1 flex items-center gap-2">
                            <ChevronDown className={`h-4 w-4 text-[#78686C] transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                            <div className="min-w-0">
                              <p className="font-medium text-[#501122] text-sm">{d.name}</p>
                              <p className="text-[11px] text-[#78686C]">{d.delivered_count} {d.delivered_count === 1 ? 'entrega' : 'entregas'} hoy</p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-heading text-lg text-[#3F634A]">{formatUSD(d.earned)}</p>
                            {d.pending_count > 0 && (
                              <p className="text-[10px] font-semibold text-[#C27A29] flex items-center justify-end gap-1 mt-0.5" data-testid={`finance-delivery-pending-${d.id}`}>
                                <Hourglass className="h-3 w-3" />+{formatUSD(d.pending_amount)} pendiente ({d.pending_count})
                              </p>
                            )}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="pb-3 pl-6 space-y-1.5" data-testid={`finance-delivery-history-${d.id}`}>
                            {(d.orders || []).length === 0 ? (
                              <p className="text-[11px] text-[#78686C] py-2">Sin entregas registradas hoy.</p>
                            ) : (d.orders || []).map(o => {
                              const tstr = o.delivered_at ? new Date(o.delivered_at).toLocaleString('es-VE', { timeZone: 'America/Caracas', hour: '2-digit', minute: '2-digit', hour12: true }) : '';
                              const items = (o.items || []).map(it => `${it.quantity}x ${it.flavor_name}`).join(', ');
                              return (
                                <div key={o.id} className="flex items-center justify-between gap-3 py-1.5 px-3 bg-[#F3EBE0]/40 rounded-xl" data-testid={`finance-delivery-order-${o.id}`}>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-semibold text-[#501122] truncate">{o.customer_name || '—'} <span className="text-[10px] font-mono text-[#78686C]">{o.order_number}</span></p>
                                    <p className="text-[10px] text-[#78686C] truncate" title={items}>{items}</p>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <p className="text-[11px] font-bold text-[#3F634A]">{formatUSD(o.delivery_fee)}</p>
                                    <p className="text-[9px] text-[#78686C]">{tstr}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      );
                    })}
                    {financeData.pending_unassigned.count > 0 && (
                      <div className="flex items-center justify-between gap-3 py-3 bg-[#C27A29]/5 -mx-5 px-5 mt-2 rounded-b-[1.5rem]" data-testid="finance-pending-unassigned">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-[#C27A29] text-sm flex items-center gap-1.5"><Hourglass className="h-3.5 w-3.5" />Sin delivery asignado</p>
                          <p className="text-[11px] text-[#78686C]">{financeData.pending_unassigned.count} {financeData.pending_unassigned.count === 1 ? 'pedido' : 'pedidos'} pagados en bolsa de Disponibles</p>
                        </div>
                        <p className="font-heading text-lg text-[#C27A29] shrink-0">{formatUSD(financeData.pending_unassigned.amount)}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* NUEVO PEDIDO */}
      {activeSection === 'nuevo-pedido' && (
        <div className="space-y-5">
          {/* Unpaid banner */}
          <OrderForm onSuccess={(newItem, removedQuoteId) => {
            if (removedQuoteId) {
              setQuotes(prev => prev.filter(q => q.id !== removedQuoteId));
            }
            if (newItem) {
              if (newItem.is_quote) {
                setQuotes(prev => [newItem, ...prev.filter(q => q.id !== newItem.id && !q.id.startsWith('temp_'))]);
              } else {
                setOrders(prev => [newItem, ...prev.filter(o => o.id !== newItem.id && !o.id.startsWith('temp_'))]);
              }
            }
            setResumingQuote(null);
            setSelectedCustomerForOrder(null);
            loadFast();
            loadQuotes();
          }}
                     initialQuote={resumingQuote}
                     initialCustomer={selectedCustomerForOrder}
                     onCancelQuote={() => { setResumingQuote(null); setSelectedCustomerForOrder(null); }} />

          {/* Cotizaciones pendientes (solo cuando no se esta retomando una).
              Envuelto en lg:pr-[360px] para respetar el panel derecho fijo del OrderForm
              y no quedar debajo del resumen. */}
          {!resumingQuote && quotes.length > 0 && (
            <div className="space-y-2 lg:pr-[360px]">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-red-600 flex items-center gap-1.5" data-testid="admin-quotes-section">
                <FileText className="h-3.5 w-3.5" />Cotizaciones pendientes ({quotes.length})
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 max-h-[380px] overflow-y-auto pr-1" data-testid="admin-quotes-grid">
              {quotes.map(q => {
                const itemsTitle = q.items?.map(i => `${i.quantity}x ${i.flavor_name}`).join(', ') || 'Sin items';
                const hasCustomer = q.customer_id && q.customer_name && q.customer_name !== '(Cotización sin cliente)';
                const cardBgClass = hasCustomer ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300';
                const itemsTextClass = hasCustomer ? 'text-emerald-700' : 'text-red-700';
                const priceTextClass = hasCustomer ? 'text-emerald-600' : 'text-red-600';
                const metaTextClass = hasCustomer ? 'text-emerald-500/70' : 'text-red-500/70';
                const buttonBgClass = hasCustomer ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-red-500 hover:bg-red-600';
                const deleteBtnClass = hasCustomer ? 'text-emerald-500' : 'text-red-500';

                return (
                <div key={q.id} className={`border-2 rounded-2xl p-3 flex flex-col gap-2 min-w-0 ${cardBgClass}`} data-testid={`admin-quote-${q.id}`}>
                  <div className="min-w-0">
                    {q.customer_name && q.customer_name !== '(Cotización sin cliente)' && (
                      <p className="text-[11px] font-bold text-emerald-700 truncate flex items-center gap-1" title={q.customer_name}>
                        <UserCheck className="h-3 w-3 shrink-0 text-emerald-600" />{q.customer_name}
                      </p>
                    )}
                    {q.quote_description && (
                      <p className="text-[11px] font-bold text-red-700 truncate flex items-center gap-1" title={q.quote_description} data-testid={`admin-quote-description-${q.id}`}>
                        <FileText className="h-3 w-3 shrink-0" />{q.quote_description}
                      </p>
                    )}
                    <p className={`font-medium text-sm truncate ${itemsTextClass}`} title={itemsTitle}>{itemsTitle}</p>
                    <p className={`text-[11px] font-semibold ${priceTextClass}`}>{formatUSD(q.total_usd)}</p>
                    <p className={`text-[10px] mt-0.5 ${metaTextClass}`}>{q.order_number} &middot; {formatDate(q.created_at)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => setResumingQuote(q)} className={`text-white h-8 rounded-full text-[11px] px-3 font-semibold flex-1 ${buttonBgClass}`} data-testid={`admin-resume-quote-${q.id}`}>
                      Retomar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => deleteQuote(q.id)} className={`h-8 rounded-full text-[11px] w-9 p-0 ${deleteBtnClass}`} data-testid={`admin-delete-quote-${q.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                );
              })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* PEDIDOS */}
      {activeSection === 'pedidos' && (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_var(--pedmap-w,520px)] gap-4 items-start" style={{ '--pedmap-w': `${mapColWidth}px` }}>
          <div className="space-y-4 min-w-0 order-2 xl:order-1">
          {/* Filtros unificados en una sola fila: estados + fechas a la izquierda, tipo a la derecha */}
          <div className="flex items-center justify-between gap-3 flex-wrap" data-testid="orders-filters-bar">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <div className="flex flex-wrap gap-1.5" data-testid="status-chips">
                {STATUS_CHIPS.map(s => {
                  const active = Array.isArray(statusFilter) ? statusFilter.includes(s.id) : statusFilter === s.id;
                  const visibleCount = (Array.isArray(orders) ? orders : []).filter(o => o.status !== 'sin_pagar' && (s.id === 'all' || o.status === s.id)).length;
                  const Icon = s.icon;
                  return (
                  <button key={s.id} onClick={() => toggleStatusFilter(s.id)} data-testid={`chip-${s.id}`}
                    title={s.label}
                    className={`h-10 w-10 rounded-full flex items-center justify-center transition-all relative
                      ${active ? s.cls + ' shadow-md scale-105' : 'bg-white text-[#78686C] border border-[#501122]/10 hover:border-[#501122]/30'}`}>
                    <Icon className="h-4 w-4" />
                    {active && (
                      <span className="absolute -top-1 -right-1 bg-white text-[#501122] rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-[9px] font-bold border border-[#501122]/15 shadow" data-testid={`chip-count-${s.id}`}>
                        {visibleCount}
                      </span>
                    )}
                  </button>
                  );
                })}
              </div>
              <Popover><PopoverTrigger asChild><Button variant="outline" className="border-[#501122]/15 text-[#501122] rounded-full h-10 px-4" data-testid="date-from-btn"><CalendarDays className="h-4 w-4 mr-1.5" />{dateFrom ? dateFrom.toLocaleDateString('es-VE') : 'Desde'}</Button></PopoverTrigger><PopoverContent className="w-auto p-0 rounded-2xl"><Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} /></PopoverContent></Popover>
              <Popover><PopoverTrigger asChild><Button variant="outline" className="border-[#501122]/15 text-[#501122] rounded-full h-10 px-4" data-testid="date-to-btn"><CalendarDays className="h-4 w-4 mr-1.5" />{dateTo ? dateTo.toLocaleDateString('es-VE') : 'Hasta'}</Button></PopoverTrigger><PopoverContent className="w-auto p-0 rounded-2xl"><Calendar mode="single" selected={dateTo} onSelect={setDateTo} /></PopoverContent></Popover>
              {(dateFrom || dateTo) && (
                <Button variant="ghost" onClick={() => { setDateFrom(null); setDateTo(null); }} className="text-[#78686C] rounded-full h-10 px-4 text-xs" data-testid="clear-dates-btn">Limpiar fechas</Button>
              )}
            </div>
            <div className="flex gap-1 bg-[#F0E4D8] rounded-full p-1" data-testid="order-type-filter">
              {[
                { id: 'all', label: 'Todos', icon: Package },
                { id: 'delivery', label: 'Delivery', icon: Truck },
                { id: 'pickup', label: 'Pickup', icon: ShoppingBag },
                { id: 'tienda', label: 'Tienda', icon: Store },
              ].map(t => {
                const active = typeFilter === t.id;
                const Icon = t.icon;
                return (
                  <button key={t.id} type="button" onClick={() => setTypeFilter(t.id)} data-testid={`type-chip-${t.id}`}
                    className={`flex items-center gap-1.5 px-3 h-8 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all
                      ${active ? 'bg-[#501122] text-white shadow-md' : 'text-[#78686C] hover:text-[#501122]'}`}>
                    <Icon className="h-3.5 w-3.5" />{t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 shadow-[0_8px_30px_rgba(80,17,34,0.03)] overflow-hidden">
            {(() => {
              const ordersForList = (Array.isArray(orders) ? orders : []).filter(o => {
                if (o.status === 'sin_pagar') return false;

                // Status chip filter
                const isAllStatus = !statusFilter || statusFilter.includes('all') || statusFilter.length === 0;
                if (!isAllStatus && !statusFilter.includes(o.status)) return false;

                // Order type chip filter
                if (typeFilter && typeFilter !== 'all' && o.order_type !== typeFilter) return false;

                // Date range filter
                if (dateFrom || dateTo) {
                  const oDateStr = o.created_at || o.scheduled_for;
                  if (oDateStr) {
                    const d = new Date(oDateStr);
                    if (dateFrom) {
                      const start = new Date(dateFrom);
                      start.setHours(0, 0, 0, 0);
                      if (d < start) return false;
                    }
                    if (dateTo) {
                      const end = new Date(dateTo);
                      end.setHours(23, 59, 59, 999);
                      if (d > end) return false;
                    }
                  }
                }

                return true;
              });
              return ordersForList.length === 0 ? <p className="text-center py-16 text-[#78686C]">Sin pedidos</p> : (
              <div>
                {ordersForList.slice(0, pedidosLimit).map(o => {
                  const gradientClass = {
                    pendiente: 'bg-gradient-to-l from-amber-300/45 via-white to-white',
                    en_camino: 'bg-gradient-to-l from-blue-400/40 via-white to-white',
                    entregado: 'bg-gradient-to-l from-[#3F634A]/35 via-white to-white',
                    cancelado: 'bg-gradient-to-l from-red-400/25 via-white to-white',
                  }[o.status] || '';
                  const typeConfig = {
                    tienda: { icon: Store, bg: 'bg-emerald-100 text-emerald-800 border-emerald-200', badgeBg: 'bg-emerald-100 text-emerald-800', border: '!border-l-4 !border-l-emerald-600', label: 'Tienda' },
                    pickup: { icon: ShoppingBag, bg: 'bg-[#C27A29]/15 text-[#C27A29] border-[#C27A29]/30', badgeBg: 'bg-[#C27A29]/15 text-[#C27A29]', border: '!border-l-4 !border-l-amber-400', label: 'Pickup' },
                    delivery: { icon: Truck, bg: 'bg-blue-100 text-blue-800 border-blue-200', badgeBg: 'bg-blue-50 text-blue-700', border: '!border-l-4 !border-l-blue-500', label: 'Delivery' },
                  }[o.order_type] || { icon: Truck, bg: 'bg-blue-100 text-blue-800 border-blue-200', badgeBg: 'bg-blue-50 text-blue-700', border: '!border-l-4 !border-l-blue-500', label: 'Delivery' };
                  const TypeIcon = typeConfig.icon;

                  return (
                  <div key={o.id} className={`p-3.5 px-4 flex flex-col md:flex-row md:items-center gap-3 relative min-h-[84px] border-t border-[#501122]/15 first:border-t-0 ${gradientClass} ${typeConfig.border}`}>
                    <div className="flex items-start md:items-center gap-3 flex-1 min-w-0">
                      {/* Icono al comienzo del pedido */}
                      <div className={`p-2.5 rounded-2xl border flex items-center justify-center shrink-0 ${typeConfig.bg}`} title={`Tipo: ${typeConfig.label}`} data-testid={`order-type-icon-${o.id}`}>
                        <TypeIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-heading text-[#501122] text-sm font-bold truncate">{o.customer_name}</span>
                          <Badge className={`${statusColors[o.status]} rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border-0 pointer-events-none hover:bg-current/0 shrink-0`}>{statusLabels[o.status]}</Badge>
                          <Badge className={`${typeConfig.badgeBg} rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border-0 pointer-events-none shrink-0`}>
                            <TypeIcon className="h-2.5 w-2.5 inline mr-0.5" />{typeConfig.label}
                          </Badge>
                          {o.created_by_name && <span className="text-[10px] text-[#78686C] shrink-0">por <span className="font-semibold text-[#501122]">{o.created_by_name}</span></span>}
                        </div>
                        {o.wait_for_notice && (
                          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1 mt-0.5" data-testid={`order-wait-notice-sublabel-${o.id}`}>
                            <Hourglass className="h-3 w-3 shrink-0 text-gray-500" />
                            esperar aviso
                          </p>
                        )}
                        <p className="text-xs text-[#78686C] mt-0.5">{o.items?.map(i => `${i.flavor_name} x${i.quantity}`).join(', ')}</p>
                        {(o.notes || o.scheduled_for || o.wait_for_notice || o.velitas || o.receiver_name || o.receiver_phone) && (
                          <div className="mt-1 flex flex-wrap gap-1" data-testid={`order-meta-${o.id}`}>
                            {o.wait_for_notice && (
                              <span className="text-[10px] text-gray-700 bg-gray-200/90 border border-gray-300/60 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1" title="Esperar aviso del cliente" data-testid={`order-wait-notice-meta-${o.id}`}>
                                <Hourglass className="h-3 w-3 shrink-0" />
                                <span className="font-bold">esperar aviso</span>
                              </span>
                            )}
                            {o.scheduled_for && (
                              <span className="text-[10px] text-[#501122] bg-[#F3EBE0]/80 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1" title="Pedido programado" data-testid={`order-scheduled-${o.id}`}>
                                <CalendarClock className="h-3 w-3 shrink-0" />
                                <span className="font-semibold">Programado:</span>
                                <span>{formatDate(o.scheduled_for)}</span>
                              </span>
                            )}
                            {o.velitas && (
                              <span className="text-[10px] text-[#C27A29] bg-[#C27A29]/10 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1" title="Requiere velitas" data-testid={`order-velitas-${o.id}`}>
                                <Cake className="h-3 w-3 shrink-0" />
                                <span className="font-semibold">Con velitas</span>
                              </span>
                            )}
                            {(o.receiver_name || o.receiver_phone) && (
                              <span className="text-[10px] text-[#501122] bg-[#F3EBE0]/80 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1 max-w-full" title="Recibe otra persona" data-testid={`order-receiver-${o.id}`}>
                                <UserRound className="h-3 w-3 shrink-0" />
                                <span className="font-semibold">Recibe:</span>
                                <span className="break-words">
                                  {o.receiver_name || ''}
                                  {o.receiver_name && o.receiver_phone ? ' · ' : ''}
                                  {o.receiver_phone || ''}
                                </span>
                              </span>
                            )}
                            {o.notes && (
                              <span className="text-[10px] text-[#501122] bg-[#F3EBE0]/80 rounded-md px-1.5 py-0.5 inline-flex items-start gap-1 max-w-full" data-testid={`order-notes-${o.id}`}>
                                <FileText className="h-3 w-3 mt-0.5 shrink-0" />
                                <span className="break-words">{o.notes}</span>
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 md:gap-4 shrink-0 justify-between md:justify-end border-t md:border-t-0 pt-2 md:pt-0 border-[#501122]/10">
                      <div className="text-right text-[10px] space-y-0 relative shrink-0 min-w-[125px]">
                        <p><span className="text-[#78686C]">Producto:</span> <span className="font-semibold text-[#501122]">{formatUSD(o.items_total || 0)}</span> <span className="text-[#78686C]">/ {formatVES(o.items_total || 0, rate)}</span></p>
                        {o.order_type === 'delivery' && (
                          <p>
                            <span className="text-[#78686C]">Delivery:</span>{' '}
                            {o.delivery_fee > 0 ? (
                              <><span className="font-semibold text-[#3F634A]">{formatUSD(o.delivery_fee || 0)}</span> <span className="text-[#78686C]">/ {formatVES(o.delivery_fee || 0, rate)}</span></>
                            ) : (
                              <span className="text-[#78686C]/70 font-medium">$0.00 (Gratis)</span>
                            )}
                          </p>
                        )}
                        <p className="pt-0.5 border-t border-[#501122]/10">
                          <span className="text-[#78686C] font-semibold">Total:</span> <span className="font-heading text-[#501122] text-sm">{formatUSD(o.total_usd)}</span> <span className="text-[#78686C]">/ {formatVES(o.total_usd, rate)}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 min-w-[110px] justify-end">
                        {o.order_type === 'delivery' && ['pendiente', 'sin_pagar', 'en_camino'].includes(o.status) ? (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button type="button" className="flex items-center gap-2 rounded-full hover:bg-[#F3EBE0]/60 transition-colors px-1 py-1" data-testid={`assign-delivery-btn-${o.id}`} title={o.delivery_id ? 'Cambiar delivery' : 'Asignar delivery'}>
                                {o.delivery_id ? (
                                  <Avatar src={o.delivery_photo_url} name={o.delivery_name} size={38} testId={`order-delivery-avatar-${o.id}`} />
                                ) : (
                                  <div className="w-9 h-9 rounded-full border-2 border-dashed border-[#501122]/30 flex items-center justify-center text-[#501122]/50">
                                    <Truck className="h-4 w-4" />
                                  </div>
                                )}
                                <div className="text-right">
                                  <p className="text-[10px] font-semibold text-[#501122]">{o.delivery_name || 'Asignar'}</p>
                                  <p className="text-[10px] text-[#78686C]">{formatDate(o.created_at)}</p>
                                </div>
                              </button>
                            </PopoverTrigger>
                            <PopoverContent className="w-64 p-2 rounded-2xl border-[#501122]/10" align="end" data-testid={`assign-popover-${o.id}`}>
                              <p className="text-[10px] uppercase tracking-wider text-[#78686C] font-semibold px-2 py-1">Elegir delivery</p>
                              <div className="max-h-64 overflow-y-auto space-y-1">
                                {users.filter(u => u.role === 'delivery' && u.id !== o.delivery_id).map(u => (
                                  <PopoverClose key={u.id} asChild>
                                    <button type="button" onClick={() => assignDelivery(o.id, u.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-[#F3EBE0]/70 transition-colors text-left" data-testid={`assign-option-${o.id}-${u.id}`}>
                                      <Avatar src={u.photo_data_url} name={u.name} size={32} />
                                      <span className="text-sm text-[#501122] font-medium truncate">{u.name}</span>
                                    </button>
                                  </PopoverClose>
                                ))}
                                {users.filter(u => u.role === 'delivery' && u.id !== o.delivery_id).length === 0 && (
                                  <p className="text-xs text-[#78686C] px-2 py-2">No hay otros deliverys disponibles</p>
                                )}
                                {o.delivery_id && (
                                  <PopoverClose asChild>
                                    <button type="button" onClick={() => unassignDelivery(o.id)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-red-50 transition-colors text-left text-red-500" data-testid={`unassign-option-${o.id}`}>
                                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
                                        <Undo2 className="h-3.5 w-3.5" />
                                      </div>
                                      <span className="text-sm font-medium">Devolver a Disponibles</span>
                                    </button>
                                  </PopoverClose>
                                )}
                              </div>
                            </PopoverContent>
                          </Popover>
                        ) : (
                          <div className="flex items-center gap-2">
                            {o.delivery_id && (
                              <Avatar src={o.delivery_photo_url} name={o.delivery_name} size={38} testId={`order-delivery-avatar-${o.id}`} />
                            )}
                            <div className="text-right">
                              <p className="text-[10px] font-semibold text-[#501122] truncate max-w-[120px]">
                                {o.delivery_name || (o.order_type === 'tienda' ? 'Venta en tienda' : o.order_type === 'pickup' ? 'Pickup en tienda' : 'Sin delivery')}
                              </p>
                              <p className="text-[10px] text-[#78686C]">{formatDate(o.created_at)}</p>
                            </div>
                          </div>
                        )}
                      </div>
                      {(o.order_type === 'pickup' || o.order_type === 'tienda') && o.status === 'pendiente' && (
                        <button type="button" onClick={() => updateStatus(o.id, 'entregado')} data-testid={`admin-pickup-deliver-inline-${o.id}`}
                          title="Marcar como Entregado"
                          className="flex items-center gap-1 h-8 px-3 rounded-full bg-[#3F634A] hover:bg-[#2E4A37] text-white text-[11px] font-bold uppercase tracking-wider shadow-sm shrink-0">
                          <PackageCheck className="h-3.5 w-3.5" />Entregado
                        </button>
                      )}
                      {['pendiente', 'sin_pagar', 'en_camino'].includes(o.status) && (
                        <button type="button" onClick={() => togglePrepared(o.id, !o.prepared)} data-testid={`prepared-toggle-${o.id}`}
                          title={o.prepared ? `Preparado por ${o.prepared_by_name || '-'}` : 'Marcar como preparado/listo'}
                          className={`flex items-center justify-center h-8 w-8 rounded-full transition-all shrink-0
                            ${o.prepared ? 'bg-[#3F634A] text-white shadow-sm' : 'bg-white border border-[#501122]/15 text-[#78686C] hover:border-[#3F634A]/40 hover:text-[#3F634A]'}`}>
                          <Check className="h-4 w-4" strokeWidth={3.5} />
                        </button>
                      )}
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            data-testid={`order-options-trigger-${o.id}`}
                            title="Opciones del pedido"
                            className="h-8 w-8 rounded-full bg-white border border-[#501122]/15 text-[#501122] hover:bg-[#F3EBE0] flex items-center justify-center transition-all shadow-sm shrink-0"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-48 p-1.5 rounded-2xl bg-white border border-[#501122]/15 shadow-xl space-y-1 z-50">
                          {o.status !== 'cancelado' && o.status !== 'entregado' && (
                            <button
                              type="button"
                              onClick={() => setEditingOrder(o)}
                              data-testid={`edit-order-${o.id}`}
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-[#501122] hover:bg-[#F3EBE0]/80 rounded-xl flex items-center gap-2 transition-colors"
                            >
                              <Pencil className="h-3.5 w-3.5 text-[#501122]" />
                              <span>Editar pedido</span>
                            </button>
                          )}
                          {o.delivery_id && ['pendiente', 'en_camino'].includes(o.status) && (
                            <PopoverClose asChild>
                              <button
                                type="button"
                                onClick={() => unassignDelivery(o.id)}
                                data-testid={`unassign-order-${o.id}`}
                                className="w-full text-left px-3 py-2 text-xs font-semibold text-[#C27A29] hover:bg-[#C27A29]/10 rounded-xl flex items-center gap-2 transition-colors"
                              >
                                <Undo2 className="h-3.5 w-3.5 text-[#C27A29]" />
                                <span>Devolver a Disponibles</span>
                              </button>
                            </PopoverClose>
                          )}
                          {o.status === 'entregado' && (
                            <button
                              type="button"
                              onClick={() => updateStatus(o.id, o.delivery_id ? 'en_camino' : 'pendiente')}
                              data-testid={`revert-order-${o.id}`}
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-xl flex items-center gap-2 transition-colors"
                            >
                              <Undo2 className="h-3.5 w-3.5 text-amber-600" />
                              <span>Revertir entregado</span>
                            </button>
                          )}
                          {o.status !== 'cancelado' && o.status !== 'entregado' && (
                            <button
                              type="button"
                              onClick={() => cancelOrder(o.id)}
                              data-testid={`cancel-order-${o.id}`}
                              className="w-full text-left px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 rounded-xl flex items-center gap-2 transition-colors"
                            >
                              <X className="h-3.5 w-3.5 text-amber-600" />
                              <span>Cancelar pedido</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDeletingOrderId(o.id)}
                            data-testid={`delete-order-${o.id}`}
                            className="w-full text-left px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-xl flex items-center gap-2 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                            <span>Eliminar pedido</span>
                          </button>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  );
                })}
                {ordersForList.length > pedidosLimit && (
                  <div className="p-4 text-center">
                    <Button variant="outline" onClick={() => setPedidosLimit(prev => prev + 10)} className="border-[#501122]/15 text-[#501122] rounded-full h-10 px-6" data-testid="load-more-orders">
                      Ver mas ({ordersForList.length - pedidosLimit} restantes)
                    </Button>
                  </div>
                )}
              </div>
            ); })()}
          </div>
          </div>{/* /pedidos left */}

          {/* RIGHT: mapa fijo a la derecha viewport-height, con handle izq para redimensionar horizontal */}
          <aside className="order-1 xl:order-2 xl:sticky xl:top-4 xl:h-[calc(100vh-2rem)] relative" data-testid="admin-pedidos-map-aside">
            {/* Left-edge drag handle for horizontal resize (hidden on mobile) */}
            <div
              className="hidden xl:flex absolute -left-1 top-0 bottom-0 w-3 items-center justify-center cursor-ew-resize z-20 group"
              onMouseDown={(e) => { e.preventDefault(); mapResizeRef.current = { startX: e.clientX, startW: mapColWidth }; }}
              onTouchStart={(e) => { const t = e.touches?.[0]; if (t) mapResizeRef.current = { startX: t.clientX, startW: mapColWidth }; }}
              onDoubleClick={() => { setMapColWidth(520); try { localStorage.setItem('lubos-pedmap-w', '520'); } catch { /* ignore */ } }}
              title="Arrastra para redimensionar (doble clic para restablecer)"
              data-testid="admin-pedidos-map-hresize"
            >
              <div className="h-16 w-1.5 rounded-full bg-[#501122]/25 group-hover:bg-[#501122]/60 transition-colors"></div>
            </div>
            <div className="xl:h-full">
              <DeliveryMap
                orders={(Array.isArray(orders) ? orders : []).filter(o => ['pendiente', 'en_camino'].includes(o.status) && o.order_type !== 'pickup')}
                title="Mapa"
                testId="admin-pedidos-map"
                centralPoint={(settings.central_point_lat && settings.central_point_lng) ? { lat: settings.central_point_lat, lng: settings.central_point_lng } : getStoredCentralPoint()}
                minimal={true}
                deliveryLocations={deliveryLocations}
              />
            </div>
          </aside>
        </div>
      )}

      {/* CLIENTES */}
      {activeSection === 'clientes' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: 'Total Clientes', value: clientStats?.total_customers || 0, icon: Users, color: 'bg-[#501122]' },
              { label: 'Recurrentes', value: clientStats?.repeat_customers || 0, sub: clientStats?.total_customers ? `${((clientStats.repeat_customers / clientStats.total_customers) * 100).toFixed(0)}%` : '0%', icon: UserCheck, color: 'bg-[#3F634A]' },
              { label: 'Activos', value: clientStats?.active_in_period || 0, icon: TrendingUp, color: 'bg-[#C27A29]' },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)]">
                <div className="flex items-center gap-3"><div className={`w-11 h-11 rounded-2xl ${s.color} flex items-center justify-center shrink-0`}><s.icon className="h-5 w-5 text-white" /></div><div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">{s.label}</p><p className="font-heading text-xl text-[#501122] truncate">{s.value}</p>{s.sub && <p className="text-[10px] text-[#78686C]">{s.sub}</p>}</div></div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={clientPeriod} onValueChange={setClientPeriod}><SelectTrigger className="w-[160px] border-[#501122]/15 text-[#501122] rounded-full h-10" data-testid="client-period-select"><SelectValue /></SelectTrigger><SelectContent className="rounded-2xl border-[#501122]/10"><SelectItem value="all">Todo el tiempo</SelectItem><SelectItem value="today">Hoy</SelectItem><SelectItem value="yesterday">Ayer</SelectItem><SelectItem value="month">Este mes</SelectItem><SelectItem value="year">Este ano</SelectItem></SelectContent></Select>
            <Input placeholder="Buscar cliente..." value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} className="bg-white border-[#501122]/15 text-[#1F1517] w-64 h-10 rounded-full px-4" data-testid="client-search-input" />
            <Button onClick={openCreateCustomer} className="bg-[#501122] hover:bg-[#3D0C19] text-white rounded-full h-10 px-5 font-semibold shadow-md ml-auto" data-testid="admin-add-customer-btn">
              <Plus className="h-4 w-4 mr-1.5" />Nuevo Cliente
            </Button>
            {loadingClientStats && <Loader2 className="h-4 w-4 animate-spin text-[#78686C]" />}
          </div>

          {filteredClients.length === 0 ? (
            <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-12 text-center text-[#78686C]">
              Sin clientes
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3.5">
              {filteredClients.map(c => {
                const initial = (c.name || '?').trim().charAt(0).toUpperCase();
                return (
                  <div
                    key={c.id}
                    onClick={() => openClientHistory(c)}
                    data-testid={`client-row-${c.id}`}
                    className="bg-white rounded-[1.25rem] border border-[#501122]/10 p-4 shadow-[0_4px_15px_rgba(80,17,34,0.02)] hover:shadow-md hover:border-[#501122]/25 transition-all duration-200 cursor-pointer flex flex-col justify-between gap-3 group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-[#501122]/10 text-[#501122] flex items-center justify-center font-extrabold text-sm shrink-0">
                          {initial}
                        </div>
                        <div className="min-w-0">
                          <p className="font-heading font-bold text-[#501122] text-sm truncate group-hover:text-[#3D0C19] flex items-center gap-1" title={c.name}>
                            <span>{c.name}</span>
                            {c.gender === 'M' && <span className="text-blue-500 font-bold shrink-0" title="Hombre">&#9794;</span>}
                            {c.gender === 'F' && <span className="text-pink-500 font-bold shrink-0" title="Mujer">&#9792;</span>}
                          </p>
                          <p className="text-[11px] text-[#78686C] flex items-center gap-1 mt-0.5 truncate">
                            <Phone className="h-3 w-3 shrink-0" />
                            <span className="truncate">{c.phone || 'Sin telf'}</span>
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[#501122]/5">
                      <Badge
                        onClick={(e) => { e.stopPropagation(); openClientHistory(c); }}
                        className="bg-[#F3EBE0] text-[#501122] hover:bg-[#501122] hover:text-white transition-colors cursor-pointer rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border-0"
                        data-testid={`client-delivered-badge-${c.id}`}
                      >
                        {c.order_count || 0} entregados
                      </Badge>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openEditCustomer(c); }}
                          className="w-7 h-7 rounded-full bg-[#F3EBE0] flex items-center justify-center text-[#501122] hover:bg-[#501122] hover:text-white transition-all active:scale-90"
                          data-testid={`client-edit-${c.id}`}
                          title="Editar cliente"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); deleteClient(c.id); }}
                            className="w-7 h-7 rounded-full bg-red-50 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-90"
                            data-testid={`client-delete-${c.id}`}
                            title="Eliminar cliente"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                        <a
                          href={`https://wa.me/${(c.phone || '').replace(/[^0-9]/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="w-7 h-7 rounded-full bg-[#25D366] flex items-center justify-center hover:bg-[#1da851] transition-all active:scale-90"
                          data-testid={`client-wa-${c.id}`}
                          title="Contactar por WhatsApp"
                        >
                          <MessageCircle className="h-3.5 w-3.5 text-white" />
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Client History Dialog */}
          <Dialog open={showClientDialog} onOpenChange={setShowClientDialog}>
            <DialogContent className="bg-white border-[#501122]/10 max-h-[85vh] overflow-y-auto rounded-[1.5rem]">
              <DialogHeader>
                <DialogTitle className="text-[#501122] font-heading flex items-center gap-1.5">
                  <span>{selectedClient?.name}</span>
                  {selectedClient?.gender === 'M' && <span className="text-blue-500 font-bold" title="Hombre">&#9794;</span>}
                  {selectedClient?.gender === 'F' && <span className="text-pink-500 font-bold" title="Mujer">&#9792;</span>}
                </DialogTitle>
              </DialogHeader>
              {selectedClient && (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-sm text-[#78686C]">
                    <Phone className="h-4 w-4" /><span>{selectedClient.phone}</span>
                    <a href={`https://wa.me/${(selectedClient.phone || '').replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-full bg-[#25D366] flex items-center justify-center hover:bg-[#1da851] transition-all ml-auto"><MessageCircle className="h-4 w-4 text-white" /></a>
                  </div>
                  <div className="flex gap-3">
                    <div className="bg-[#F3EBE0] rounded-2xl p-3 flex-1 text-center"><p className="font-heading text-xl text-[#501122]">{clientHistory.filter(o => o.status === 'entregado').length || selectedClient.order_count || 0}</p><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Entregados</p></div>
                    <div className="bg-[#F3EBE0] rounded-2xl p-3 flex-1 text-center"><p className="font-heading text-xl text-[#501122]">{formatUSD(clientHistory.filter(o => o.status === 'entregado').reduce((s, o) => s + (o.total_usd || 0), 0))}</p><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Total gastado</p></div>
                  </div>
                  <div className="border-t border-[#501122]/10 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-3">Historial de Pedidos</p>
                    {loadingHistory ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-[#78686C]" /></div> : clientHistory.length === 0 ? <p className="text-center py-8 text-[#78686C] text-sm">Sin pedidos</p> : (
                      <div className="space-y-2">
                        {clientHistory.map(o => (
                          <div key={o.id} className="py-3 border-b border-[#501122]/5 last:border-0">
                            <div className="flex justify-between items-start">
                              <div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-1"><span className="text-[10px] font-mono text-[#78686C]">{o.order_number}</span><Badge className={`${statusColors[o.status]} rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border-0`}>{statusLabels[o.status]}</Badge></div><p className="text-sm text-[#1F1517]/70">{o.items?.map(i => `${i.flavor_name} x${i.quantity}`).join(', ')}</p><p className="text-[10px] text-[#78686C] mt-0.5">{formatDate(o.created_at)}</p></div>
                              <span className="font-heading text-sm text-[#501122] shrink-0 ml-3">{formatUSD(o.total_usd)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => openEditCustomer(selectedClient)} variant="outline" className="flex-1 border-[#501122]/15 text-[#501122] hover:bg-[#501122]/5 h-10 rounded-full text-sm font-semibold" data-testid="edit-client-btn"><Pencil className="h-4 w-4 mr-1.5" />Editar Datos</Button>
                    {isAdmin && <Button variant="ghost" onClick={() => deleteClient(selectedClient.id)} className="flex-1 text-red-500 hover:bg-red-50 h-10 rounded-full text-sm" data-testid="delete-client-btn"><Trash2 className="h-4 w-4 mr-1.5" />Eliminar</Button>}
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Customer Create/Edit Dialog */}
          <Dialog open={showCustomerForm} onOpenChange={setShowCustomerForm}>
            <DialogContent className="bg-white border-[#501122]/10 rounded-[1.5rem]" data-testid="customer-form-dialog">
              <DialogHeader>
                <DialogTitle className="text-[#501122] font-heading">{editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Nombre completo</Label>
                  <Input value={customerForm.name} onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                    placeholder="Oscar Ochoa" className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-4" data-testid="admin-customer-name-input" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">WhatsApp</Label>
                  <div className="flex gap-2">
                    <Input 
                      value={customerForm.prefix} 
                      onChange={(e) => setCustomerForm({ ...customerForm, prefix: '+' + e.target.value.replace(/\D/g, '') })}
                      className="w-20 bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-2 text-center font-medium" 
                      data-testid="admin-customer-prefix" 
                    />
                    <Input value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value.replace(/\D/g, '') })}
                      placeholder="4124567890" className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-4 flex-1" data-testid="admin-customer-phone-input" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCustomerForm({ ...customerForm, gender: 'M' })} data-testid="customer-gender-m"
                    className={`flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl font-semibold text-sm transition-all border-2
                      ${customerForm.gender === 'M' ? 'bg-blue-500 text-white border-blue-500 shadow-md' : 'bg-blue-50 text-blue-600 border-blue-200 hover:border-blue-400'}`}>
                    <span className="text-lg">&#9794;</span>Hombre
                  </button>
                  <button type="button" onClick={() => setCustomerForm({ ...customerForm, gender: 'F' })} data-testid="customer-gender-f"
                    className={`flex-1 flex items-center justify-center gap-2 h-12 rounded-2xl font-semibold text-sm transition-all border-2
                      ${customerForm.gender === 'F' ? 'bg-pink-500 text-white border-pink-500 shadow-md' : 'bg-pink-50 text-pink-600 border-pink-200 hover:border-pink-400'}`}>
                    <span className="text-lg">&#9792;</span>Mujer
                  </button>
                </div>
                <Button onClick={saveCustomer} className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-semibold shadow-md" data-testid="save-customer-admin-btn">
                  {editingCustomer ? 'Actualizar' : 'Guardar Cliente'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* CONFIG sub-tabs strip */}
      {activeSection === 'config' && (
        <div className="flex gap-1 bg-[#F0E4D8] rounded-full p-1.5 w-fit flex-wrap" data-testid="config-subtabs">
          {configTabs.map(t => (
            <button key={t.id} onClick={() => setConfigSubSection(t.id)} data-testid={`config-subtab-${t.id}`}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-300
                ${configSubSection === t.id ? 'bg-white text-[#501122] shadow-sm' : 'text-[#78686C] hover:text-[#501122]'}`}>
              <t.icon className="h-3.5 w-3.5" />{t.label}
            </button>
          ))}
        </div>
      )}

      {/* SABORES */}
      {activeSection === 'config' && configSubSection === 'sabores' && (
        <div className="space-y-5">
          <div className="flex justify-between items-center"><h3 className="font-heading text-xl text-[#501122]">Sabores & Inventario</h3><Button onClick={openAddFlavor} className="bg-[#501122] hover:bg-[#3D0C19] text-white rounded-full h-10 px-5 font-semibold shadow-md" data-testid="add-flavor-btn"><Plus className="h-4 w-4 mr-1.5" />Nuevo</Button></div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {flavors.map((f, idx) => (
              <div key={f.id} className="bg-white rounded-[1.5rem] border border-[#501122]/10 p-5 shadow-[0_8px_30px_rgba(80,17,34,0.03)] transition-all hover:-translate-y-1 relative" data-testid={`flavor-card-${f.id}`}>
                {/* Reorder handles */}
                <div className="absolute top-3 left-3 flex flex-col gap-0.5 bg-white/80 border border-[#501122]/10 rounded-full shadow-sm" data-testid={`flavor-reorder-${f.id}`}>
                  <button type="button" onClick={() => moveFlavor(idx, -1)} disabled={idx === 0} data-testid={`flavor-up-${f.id}`}
                    className="w-6 h-6 flex items-center justify-center rounded-full text-[#501122] hover:bg-[#F3EBE0] disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Subir">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" onClick={() => moveFlavor(idx, +1)} disabled={idx === flavors.length - 1} data-testid={`flavor-down-${f.id}`}
                    className="w-6 h-6 flex items-center justify-center rounded-full text-[#501122] hover:bg-[#F3EBE0] disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Bajar">
                    <ChevronDownIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex justify-between items-start mb-4 gap-3 pl-8">
                  {f.image && <img src={f.image} alt={f.name} className="w-16 h-16 rounded-2xl object-cover border border-[#501122]/10 shrink-0" data-testid={`flavor-img-${f.id}`} />}
                  <div className="flex-1 min-w-0"><p className="font-heading text-[#501122] text-lg truncate">{f.name}</p><p className="font-heading text-[#501122] text-sm mt-0.5">{formatUSD(f.price_usd)}<span className="text-xs font-normal text-[#78686C] ml-1">{formatVES(f.price_usd, rate)}</span></p></div>
                  <Badge className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider border-0 shrink-0 ${f.available ? 'bg-[#3F634A]/15 text-[#3F634A]' : 'bg-red-100 text-red-700'}`}>{f.available ? 'Activo' : 'Inactivo'}</Badge>
                </div>
                <div className="bg-[#F3EBE0] rounded-2xl p-4 mb-4 flex items-center justify-between gap-3">
                  <div><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#78686C]">Inventario</p><p className="font-heading text-2xl text-[#501122] mt-0.5">{f.stock_unlimited ? '∞' : (f.stock || 0)}<span className="text-sm font-normal text-[#78686C] ml-1">{f.stock_unlimited ? 'por pedido' : 'porciones'}</span></p></div>
                  {!f.stock_unlimited && (
                    <Button size="sm" variant="outline" onClick={() => openStockDialog(f)} className="border-[#501122]/15 text-[#501122] rounded-full h-9 px-3 text-xs font-semibold shrink-0" data-testid={`stock-movement-btn-${f.id}`}>
                      <History className="h-3.5 w-3.5 mr-1" />Ajustar
                    </Button>
                  )}
                </div>
                <div className="flex gap-2"><Button variant="outline" size="sm" className="border-[#501122]/15 text-[#501122] flex-1 rounded-full h-9" onClick={() => openEditFlavor(f)} data-testid={`edit-flavor-${f.id}`}><Pencil className="h-3 w-3 mr-1" />Editar</Button><Button variant="ghost" size="sm" className="text-red-500 rounded-full h-9 w-9 p-0" onClick={() => deleteFlavor(f.id)} data-testid={`delete-flavor-${f.id}`}><Trash2 className="h-3.5 w-3.5" /></Button></div>
              </div>
            ))}
          </div>
          <Dialog open={showFlavorDialog} onOpenChange={setShowFlavorDialog}>
            <DialogContent className="bg-white border-[#501122]/10 rounded-[1.5rem]"><DialogHeader><DialogTitle className="text-[#501122] font-heading">{editingFlavor ? 'Editar Sabor' : 'Nuevo Sabor'}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2"><Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Nombre</Label><Input value={flavorForm.name} onChange={(e) => setFlavorForm({ ...flavorForm, name: e.target.value })} className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-4" data-testid="flavor-name-input" /></div>
                <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Precio USD</Label><Input type="number" step="0.01" value={flavorForm.price_usd} onChange={(e) => setFlavorForm({ ...flavorForm, price_usd: e.target.value })} className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-4" data-testid="flavor-price-input" /></div><div className="space-y-2"><Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Stock</Label><Input type="number" value={flavorForm.stock} onChange={(e) => setFlavorForm({ ...flavorForm, stock: e.target.value })} disabled={flavorForm.stock_unlimited} className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-4 disabled:opacity-50" data-testid="flavor-stock-input" /></div></div>
                <div className="flex items-center gap-3 bg-[#F3EBE0]/60 rounded-2xl p-3 border border-[#501122]/5">
                  <Switch checked={!!flavorForm.stock_unlimited} onCheckedChange={(v) => setFlavorForm({ ...flavorForm, stock_unlimited: v })} data-testid="flavor-unlimited-toggle" />
                  <div>
                    <Label className="text-sm font-semibold text-[#501122] cursor-pointer">Por pedido (sin stock)</Label>
                    <p className="text-[10px] text-[#78686C]">Se hace bajo demanda — no se descuenta stock al vender</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Imagen (cuadrada)</Label>
                  <div className="flex items-center gap-3">
                    {flavorForm.image ? (
                      <div className="relative shrink-0">
                        <img src={flavorForm.image} alt="" className="w-20 h-20 rounded-2xl object-cover border border-[#501122]/10" data-testid="flavor-image-preview" />
                        <button type="button" onClick={() => setFlavorForm({ ...flavorForm, image: '' })}
                          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow hover:bg-red-600" data-testid="flavor-image-remove">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-2xl bg-[#F3EBE0] flex items-center justify-center text-[#78686C] shrink-0">
                        <ImagePlus className="h-6 w-6" />
                      </div>
                    )}
                    <label className="flex-1 cursor-pointer">
                      <div className="bg-[#F3EBE0] hover:bg-[#E8DCC8] border border-dashed border-[#501122]/20 rounded-2xl px-4 py-3 text-center transition-colors">
                        <p className="text-xs font-semibold text-[#501122]">{flavorForm.image ? 'Cambiar imagen' : 'Subir imagen'}</p>
                        <p className="text-[10px] text-[#78686C] mt-0.5">Se recortara automaticamente a cuadrado</p>
                      </div>
                      <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFlavorImage(e.target.files?.[0])} data-testid="flavor-image-input" />
                    </label>
                  </div>
                </div>
                <div className="flex items-center gap-3"><Switch checked={flavorForm.available} onCheckedChange={(v) => setFlavorForm({ ...flavorForm, available: v })} data-testid="flavor-available-switch" /><Label className="text-[#78686C]">Disponible para venta</Label></div>
                <Button onClick={saveFlavor} className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-semibold shadow-md" data-testid="save-flavor-btn">{editingFlavor ? 'Actualizar' : 'Crear Sabor'}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* MAPA */}
      {activeSection === 'config' && configSubSection === 'mapa' && (
        <div className="space-y-5">
          <ErrorBoundary
            title="Error cargando el mapa"
            message="Esta seccion necesita Google Maps con la libreria Visualization habilitada. Verifica que la API key en Google Cloud Console permita el dominio actual."
          >
            <SalesHeatmap />
          </ErrorBoundary>
        </div>
      )}

      {/* EQUIPO */}
      {activeSection === 'config' && configSubSection === 'equipo' && (
        <div className="space-y-5">
          <div className="flex justify-between items-center"><h3 className="font-heading text-xl text-[#501122]">Equipo</h3><Button onClick={openAddUser} className="bg-[#501122] hover:bg-[#3D0C19] text-white rounded-full h-10 px-5 font-semibold shadow-md" data-testid="add-user-btn"><Plus className="h-4 w-4 mr-1.5" />Nuevo</Button></div>
          <div className="bg-white rounded-[1.5rem] border border-[#501122]/10 shadow-[0_8px_30px_rgba(80,17,34,0.03)] overflow-hidden">
            <div className="divide-y divide-[#501122]/5">
              {users.map(u => (
                <div key={u.id} className="p-5 flex items-center gap-4">
                  <label className="relative group cursor-pointer shrink-0" title="Cambiar foto">
                    <Avatar src={u.photo_data_url} name={u.name} size={44} testId={`user-avatar-${u.id}`} />
                    <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                      <Camera className="h-4 w-4 text-white" />
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) updateUserPhoto(u.id, f); e.target.value = ''; }}
                      data-testid={`user-photo-input-${u.id}`}
                    />
                  </label>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-heading text-[#501122] text-sm font-semibold">{u.name}</p>
                      <span className="w-3 h-3 rounded-full border border-black/15 shrink-0 shadow-sm" style={{ backgroundColor: u.color || '#501122' }} title={`Color asignado: ${u.color || '#501122'}`} />
                    </div>
                    <p className="text-xs text-[#78686C]">@{u.username}</p>
                  </div>
                  <Badge className="bg-[#F3EBE0] text-[#501122] rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider border-0">{roleLabels[u.role]}</Badge>
                  <div className="flex gap-1">
                    {u.photo_data_url && (
                      <Button variant="ghost" size="sm" className="text-[#78686C] h-8 w-8 rounded-full p-0" onClick={() => clearUserPhoto(u.id)} title="Quitar foto" data-testid={`clear-photo-${u.id}`}><X className="h-3.5 w-3.5" /></Button>
                    )}
                    <Button variant="ghost" size="sm" className="text-[#501122] h-8 w-8 rounded-full p-0" onClick={() => openEditUser(u)} data-testid={`edit-user-${u.id}`}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="sm" className="text-red-500 h-8 w-8 rounded-full p-0" onClick={() => deleteUser(u.id)} data-testid={`delete-user-${u.id}`}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
            <DialogContent className="bg-white border-[#501122]/10 rounded-[1.5rem]"><DialogHeader><DialogTitle className="text-[#501122] font-heading">{editingUser ? 'Editar Usuario' : 'Nuevo Usuario'}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2"><Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Nombre</Label><Input value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-4" data-testid="user-name-input" /></div>
                <div className="space-y-2"><Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Usuario</Label><Input value={userForm.username} onChange={(e) => setUserForm({ ...userForm, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })} placeholder="usuario" autoComplete="off" className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-4" data-testid="user-username-input" /></div>
                <div className="space-y-2"><Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">{editingUser ? 'Nueva Contrasena (vacio = no cambiar)' : 'Contrasena'}</Label><Input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} autoComplete="new-password" className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl px-4" data-testid="user-password-input" /></div>
                <div className="space-y-2"><Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Rol</Label><Select value={userForm.role} onValueChange={(v) => setUserForm({ ...userForm, role: v })}><SelectTrigger className="bg-[#F3EBE0] border-[#501122]/10 text-[#1F1517] h-12 rounded-2xl" data-testid="user-role-select"><SelectValue /></SelectTrigger><SelectContent className="rounded-2xl border-[#501122]/10"><SelectItem value="admin">Administrador</SelectItem><SelectItem value="vendedor">Vendedor</SelectItem><SelectItem value="delivery">Repartidor</SelectItem></SelectContent></Select></div>
                
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Color del Miembro (Para Mapa y Perfil)</Label>
                  <div className="flex flex-wrap gap-2 items-center">
                    {['#501122', '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'].map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => setUserForm({ ...userForm, color: col })}
                        className="w-8 h-8 rounded-full border-2 transition-transform active:scale-95 shrink-0"
                        style={{
                          backgroundColor: col,
                          borderColor: userForm.color === col ? '#1F1517' : 'transparent',
                          boxShadow: userForm.color === col ? '0 0 0 1px rgba(0,0,0,0.1)' : 'none',
                        }}
                        title={col}
                      />
                    ))}
                    <div className="relative w-8 h-8 rounded-full border border-[#501122]/20 overflow-hidden shrink-0 shadow-inner" title="Color personalizado">
                      <input
                        type="color"
                        value={userForm.color || '#501122'}
                        onChange={(e) => setUserForm({ ...userForm, color: e.target.value })}
                        className="absolute inset-[-4px] w-[40px] h-[40px] cursor-pointer border-0 p-0"
                      />
                    </div>
                  </div>
                </div>

                <Button onClick={saveUser} className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-semibold shadow-md" data-testid="save-user-btn">{editingUser ? 'Actualizar' : 'Crear Usuario'}</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* WIDGETS */}
      {activeSection === 'config' && configSubSection === 'widgets' && (
        <WidgetsSection
          widgetSettings={widgetSettings}
          setWidgetSettings={setWidgetSettings}
          availableFlavors={availableFlavors}
        />
      )}

      {/* CONFIG GENERAL */}
      {activeSection === 'config' && configSubSection === 'general' && (
        <ConfigSection
          settings={settings}
          exchangeRate={exchangeRate}
          setExchangeRate={setExchangeRate}
          onSaved={loadAll}
        />
      )}

      <PasswordConfirmDialog
        open={!!deletingOrderId}
        onOpenChange={(o) => { if (!o) setDeletingOrderId(null); }}
        onConfirm={confirmDeleteOrder}
        title="Eliminar pedido permanentemente"
        description="Esta accion es irreversible. Se restaura stock si aplica. Ingresa la contrasena de seguridad."
        testId="delete-order-confirm"
      />

      <EditOrderDialog
        order={editingOrder}
        open={!!editingOrder}
        onOpenChange={(o) => { if (!o) setEditingOrder(null); }}
        onSaved={loadAll}
      />


      {/* Stock Movement Dialog (shared) */}
      <Dialog open={showStockDialog} onOpenChange={setShowStockDialog}>
        <DialogContent className="bg-white border-[#501122]/10 rounded-[1.5rem] max-w-lg" data-testid="stock-movement-dialog">
          <DialogHeader>
            <DialogTitle className="text-[#501122] font-heading">Ajustar stock - {stockFlavor?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-[#F3EBE0] rounded-2xl p-4 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Stock actual</p>
              <p className="font-heading text-2xl text-[#501122]">{stockFlavor?.stock || 0}</p>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-end">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Cantidad (+/-)</Label>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="sm" onClick={() => setStockDelta(d => String((parseInt(d || 0) || 0) - 1))} className="border-[#501122]/15 text-[#501122] rounded-full h-10 w-10 p-0 shrink-0" data-testid="stock-dec-btn">
                    <Minus className="h-4 w-4" />
                  </Button>
                  <Input type="number" value={stockDelta} onChange={(e) => setStockDelta(e.target.value)}
                    placeholder="+7 o -1" className="bg-[#F3EBE0] border-[#501122]/10 h-10 rounded-2xl px-3 text-center font-bold" data-testid="stock-delta-input" />
                  <Button variant="outline" size="sm" onClick={() => setStockDelta(d => String((parseInt(d || 0) || 0) + 1))} className="border-[#501122]/15 text-[#501122] rounded-full h-10 w-10 p-0 shrink-0" data-testid="stock-inc-btn">
                    <PlusIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="text-2xl font-heading text-[#78686C] pb-2">=</div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Resultado</Label>
                <div className="bg-[#3F634A]/10 text-[#3F634A] rounded-2xl h-10 flex items-center justify-center font-heading text-lg" data-testid="stock-result">
                  {Math.max(0, (stockFlavor?.stock || 0) + (parseInt(stockDelta || 0) || 0))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Descripcion</Label>
              <Input value={stockDesc} onChange={(e) => setStockDesc(e.target.value)}
                placeholder="ej: produccion del dia, consumo interno..." className="bg-[#F3EBE0] border-[#501122]/10 h-12 rounded-2xl px-4" data-testid="stock-description-input" />
            </div>
            <Button onClick={saveStockMovement} className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-semibold shadow-md" data-testid="save-stock-movement-btn">
              Guardar movimiento
            </Button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C] mb-2 flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" />Historial
              </p>
              <div className="max-h-60 overflow-y-auto space-y-1.5">
                {stockMovements.length === 0 ? (
                  <p className="text-xs text-[#78686C] text-center py-4">Sin movimientos aun</p>
                ) : stockMovements.map(m => (
                  <div key={m.id} className="flex items-center justify-between py-2 px-3 bg-[#F3EBE0]/40 rounded-xl text-xs" data-testid={`stock-movement-${m.id}`}>
                    <div className="min-w-0">
                      <span className={`font-bold ${m.delta > 0 ? 'text-[#3F634A]' : 'text-red-600'}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</span>
                      <span className="text-[#78686C] ml-2">&rarr; {m.new_stock}</span>
                      <p className="text-[10px] text-[#78686C] truncate">{m.description || '(sin descripcion)'} - {m.user_name}</p>
                    </div>
                    <span className="text-[9px] text-[#78686C] shrink-0 ml-2">{new Date(m.created_at).toLocaleString('es-VE', { timeZone: 'America/Caracas', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import New Customers Classification Dialog */}
      <Dialog open={showImportCustomersDialog} onOpenChange={setShowImportCustomersDialog}>
        <DialogContent className="bg-white border-[#501122]/10 rounded-[1.5rem] max-w-lg max-h-[85vh] flex flex-col p-6" data-testid="import-customers-dialog">
          <DialogHeader className="shrink-0 pb-3 border-b border-[#501122]/5">
            <DialogTitle className="text-[#501122] font-heading text-lg">Nuevos Clientes Agregados</DialogTitle>
            <p className="text-xs text-[#78686C] mt-1">Por favor, clasifica si los siguientes clientes importados son Hombre o Mujer de forma manual antes de guardar.</p>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 py-4 pr-1">
            {importedNewCustomers.map((cust) => (
              <div key={cust.id} className="p-4 bg-[#F3EBE0]/45 border border-[#501122]/5 rounded-2xl flex items-center justify-between gap-4" data-testid={`import-cust-row-${cust.id}`}>
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-[#1F1517] truncate">{cust.name}</p>
                  <p className="text-xs text-[#78686C] mt-0.5">{cust.phone || 'Sin número'}</p>
                </div>
                
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleImportGenderSelect(cust.id, 'M')}
                    className={`h-9 px-3.5 rounded-full text-xs font-semibold border transition-all duration-200 ${
                      cust.gender === 'M'
                        ? 'bg-blue-500 text-white border-blue-500 shadow-sm'
                        : 'bg-blue-50/50 text-blue-600 border-blue-100 hover:border-blue-200'
                    }`}
                    data-testid={`import-cust-m-${cust.id}`}
                  >
                    Hombre
                  </button>
                  <button
                    type="button"
                    onClick={() => handleImportGenderSelect(cust.id, 'F')}
                    className={`h-9 px-3.5 rounded-full text-xs font-semibold border transition-all duration-200 ${
                      cust.gender === 'F'
                        ? 'bg-pink-500 text-white border-pink-500 shadow-sm'
                        : 'bg-pink-50/50 text-pink-600 border-pink-100 hover:border-pink-200'
                    }`}
                    data-testid={`import-cust-f-${cust.id}`}
                  >
                    Mujer
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="shrink-0 pt-3 border-t border-[#501122]/5 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setShowImportCustomersDialog(false)}
              className="border-[#501122]/15 text-[#501122] rounded-full h-11 px-6 font-semibold"
              disabled={savingImportGenders}
            >
              Cancelar
            </Button>
            <Button
              onClick={saveImportGenders}
              disabled={savingImportGenders}
              className="bg-[#3F634A] hover:bg-[#2D4D35] text-white rounded-full h-11 px-6 font-semibold shadow-md flex items-center justify-center gap-1.5"
              data-testid="save-import-genders-btn"
            >
              {savingImportGenders ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar clientes'
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mobile Bottom Nav */}
      </div>{/* /content col */}

      {/* Mobile Bottom Nav - kept here to remain on screen when scrolling, sidebar covers desktop */}
      <div className="fixed bottom-4 left-4 right-4 md:hidden bg-white/90 backdrop-blur-xl border border-[#501122]/10 shadow-xl rounded-[2rem] flex justify-around p-2 z-50">
        {navItems.map(n => (
          <button key={n.id} onClick={() => setActiveSection(n.id)} data-testid={`admin-mobile-tab-${n.id}`}
            className={`flex flex-col items-center gap-0.5 py-1.5 px-2 rounded-2xl transition-all duration-300 ${activeSection === n.id ? 'text-[#501122] bg-[#501122]/5' : 'text-[#78686C]'}`}>
            <n.icon className={`h-5 w-5 ${activeSection === n.id ? 'stroke-[2.5px]' : ''}`} />
            {activeSection === n.id && <span className="text-[8px] font-semibold">{n.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
