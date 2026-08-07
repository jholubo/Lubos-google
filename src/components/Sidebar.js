/**
 * Sidebar vertical para desktop.
 *
 * Contiene TODO el chrome de navegación / identidad: logo, avatar del usuario,
 * nav, RecordsBar y footer (BCV + sonido + logout). En móvil se oculta.
 *
 * Props:
 *   - items: [{ id, icon, label }]
 *   - activeId: string
 *   - onSelect: (id) => void
 *   - testIdPrefix: string (ej: "admin-tab")
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { LogOut, Volume2, VolumeX, RefreshCw, Loader2, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import api from '@/lib/api';
import { getLocalCache, setLocalCache } from '@/lib/cache';
import Avatar from '@/components/Avatar';
import RecordsBar from '@/components/RecordsBar';

const roleLabels = { admin: 'Administrador', vendedor: 'Vendedor', delivery: 'Repartidor' };

// Read the persisted collapse state (kept outside so dashboards can also read it if needed)
export function getSidebarCollapsed() {
  try { return localStorage.getItem('lubos-sidebar-collapsed') === '1'; } catch { return false; }
}
// Subscribe to sidebar collapse changes so main content can shift.
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(() => getSidebarCollapsed());
  useEffect(() => {
    const onChange = (e) => setCollapsed(!!e.detail);
    window.addEventListener('lubos:sidebar-toggle', onChange);
    return () => window.removeEventListener('lubos:sidebar-toggle', onChange);
  }, []);
  return collapsed;
}

export default function Sidebar({ items, activeId, onSelect, testIdPrefix = 'nav' }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [rate, setRate] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [collapsed, setCollapsed] = useState(() => getSidebarCollapsed());
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('lubos-sound-enabled') !== 'false'; } catch { return true; }
  });

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { localStorage.setItem('lubos-sidebar-collapsed', next ? '1' : '0'); } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('lubos:sidebar-toggle', { detail: next }));
      return next;
    });
  };

  const toggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem('lubos-sound-enabled', String(next)); } catch { /* storage unavailable */ }
      toast.success(next ? 'Notificaciones activadas' : 'Notificaciones silenciadas');
      return next;
    });
  };

  const loadRate = useCallback(async () => {
    const cSettings = getLocalCache('settings');
    if (cSettings?.exchange_rate_ves) setRate(cSettings.exchange_rate_ves);

    try {
      const { data } = await api.get('/settings');
      setRate(data.exchange_rate_ves);
      setLocalCache('settings', data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadRate();
    const interval = setInterval(loadRate, 60000);
    window.addEventListener('lubos:settings-changed', loadRate);
    return () => {
      clearInterval(interval);
      window.removeEventListener('lubos:settings-changed', loadRate);
    };
  }, [loadRate]);

  const refreshRate = async () => {
    setRefreshing(true);
    try {
      const { data } = await api.get('/bcv-rate');
      setRate(data.rate);
      toast.success(`Tasa BCV: ${data.rate.toFixed(2)} Bs`);
    } catch { toast.error('No se pudo actualizar la tasa'); }
    setRefreshing(false);
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  const showRecords = user?.role === 'admin' || user?.role === 'vendedor';

  return (
    <aside
      className={`hidden md:flex flex-col shrink-0 fixed left-0 top-0 h-screen z-40 bg-white border-r border-[#501122]/10 shadow-[0_8px_30px_rgba(80,17,34,0.03)] transition-[width] duration-200 ease-out ${collapsed ? 'w-16 p-2 gap-2 items-center' : 'w-56 p-3 gap-2.5'}`}
      data-testid={`${testIdPrefix}-sidebar`}
      data-collapsed={collapsed ? '1' : '0'}
    >
      {/* Collapse toggle — kept ON the sidebar edge without being clipped */}
      <button
        type="button"
        onClick={toggleCollapsed}
        title={collapsed ? 'Expandir' : 'Colapsar'}
        className="absolute -right-3 top-6 z-[60] h-6 w-6 rounded-full bg-white border border-[#501122]/15 shadow-md flex items-center justify-center text-[#501122] hover:bg-[#F3EBE0]"
        data-testid="sidebar-collapse-toggle"
      >
        {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
      </button>

      {/* Scrollable inner container */}
      <div className={`flex-1 flex flex-col ${collapsed ? 'items-center gap-2' : 'gap-2.5'} min-h-0 overflow-y-auto -mx-1 px-1 w-full`}>
        {/* Logo + user header */}
        <div className="flex flex-col items-center gap-2 pb-2.5 border-b border-[#501122]/10 w-full">
          {!collapsed ? (
            <div className="flex items-center justify-between w-full px-0.5">
              <img src="/logo.svg" alt="Lubo's" className="h-7 w-auto" data-testid="sidebar-logo" />
              <span className="text-[9px] font-extrabold uppercase tracking-wider bg-[#501122]/10 text-[#501122] px-2 py-0.5 rounded-full" data-testid="sidebar-user-role">
                {roleLabels[user?.role] || user?.role}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-center py-0.5">
              <span className="text-sm font-black font-heading text-[#501122] bg-[#501122]/10 w-8 h-8 rounded-xl flex items-center justify-center shadow-2xs" title="Lubo's Tiramisú">
                L
              </span>
            </div>
          )}

          <div className={`flex ${collapsed ? 'flex-col items-center gap-1' : 'items-center gap-2.5 w-full bg-[#501122]/5 p-2 rounded-2xl border border-[#501122]/10'}`}>
            <Avatar src={user?.photo_data_url} name={user?.name} size={collapsed ? 36 : 40} testId="sidebar-user-avatar" />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="font-heading text-xs font-bold text-[#501122] truncate leading-tight" data-testid="sidebar-user-name">{user?.name}</p>
                <p className="text-[10px] text-[#78686C] font-mono truncate">@{user?.username}</p>
              </div>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className={`flex flex-col gap-1 ${collapsed ? 'w-full items-center' : 'w-full'}`}>
          {items.map(n => (
            <button key={n.id} onClick={() => onSelect(n.id)} data-testid={`${testIdPrefix}-${n.id}`}
              title={collapsed ? n.label : undefined}
              className={`flex items-center ${collapsed ? 'justify-center w-10 h-10' : 'gap-2.5 px-3 py-2.5'} rounded-xl text-xs font-bold transition-all duration-200 text-left
                ${activeId === n.id
                  ? 'bg-[#501122] text-white shadow-sm scale-[1.02]'
                  : 'text-[#78686C] hover:bg-[#F3EBE0] hover:text-[#501122]'}`}>
              <n.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{n.label}</span>}
            </button>
          ))}
        </nav>

        {/* Records bar (admin & vendedor) - Justified to bottom */}
        {showRecords && (
          <div className={`mt-auto pt-2 border-t border-[#501122]/10 ${collapsed ? 'w-full' : 'w-full'}`}>
            <RecordsBar collapsed={collapsed} />
          </div>
        )}

        {/* Footer: BCV + sound + logout */}
        <div className={`pt-2 border-t border-[#501122]/10 space-y-2 ${collapsed ? 'w-full flex flex-col items-center' : 'w-full'}`}>
          {rate !== null && (
            collapsed ? (
              <button
                onClick={refreshRate}
                disabled={refreshing}
                className="w-9 h-9 flex flex-col items-center justify-center bg-[#3F634A]/10 hover:bg-[#3F634A]/20 border border-[#3F634A]/20 rounded-xl text-[#3F634A] transition-all active:scale-90 disabled:opacity-60"
                title={`Tasa BCV: ${rate.toFixed(2)} Bs (Haz clic para actualizar)`}
                data-testid="sidebar-bcv-rate"
              >
                {refreshing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <span className="text-[8px] font-black leading-none uppercase">BCV</span>
                    <span className="text-[9px] font-extrabold leading-none mt-0.5">{Math.round(rate)}</span>
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={refreshRate}
                disabled={refreshing}
                className="w-full flex items-center justify-between gap-1.5 bg-[#3F634A]/10 hover:bg-[#3F634A]/15 border border-[#3F634A]/20 rounded-full px-3 py-1.5 transition-all active:scale-95 disabled:opacity-60 group"
                data-testid="sidebar-bcv-rate"
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#3F634A]">BCV</span>
                <span className="text-xs font-bold text-[#501122] tabular-nums">
                  {rate.toFixed(2)} <span className="text-[9px] font-semibold text-[#78686C]">Bs</span>
                </span>
                {refreshing ? <Loader2 className="h-3 w-3 text-[#3F634A] animate-spin" /> : <RefreshCw className="h-3 w-3 text-[#3F634A] opacity-40 group-hover:opacity-100" />}
              </button>
            )
          )}
          <div className={`flex gap-2 ${collapsed ? 'flex-col items-center' : 'w-full'}`}>
            <button
              onClick={toggleSound}
              className={`flex-1 flex items-center justify-center h-9 ${collapsed ? 'w-9' : ''} rounded-full transition-all active:scale-90 ${soundEnabled ? 'bg-[#3F634A]/10 text-[#3F634A] border border-[#3F634A]/20' : 'bg-[#78686C]/10 text-[#78686C] border border-[#78686C]/20'}`}
              title={soundEnabled ? 'Silenciar' : 'Activar sonido'}
              data-testid="sidebar-sound-toggle"
            >
              {soundEnabled ? <Volume2 className="h-[16px] w-[16px]" /> : <VolumeX className="h-[16px] w-[16px]" />}
            </button>
            <button
              onClick={handleLogout}
              className={`flex-1 flex items-center justify-center h-9 ${collapsed ? 'w-9' : ''} rounded-full bg-[#501122]/5 hover:bg-[#501122]/10 text-[#501122] transition-all active:scale-90`}
              title="Cerrar sesión"
              data-testid="sidebar-logout"
            >
              <LogOut className="h-[16px] w-[16px]" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
