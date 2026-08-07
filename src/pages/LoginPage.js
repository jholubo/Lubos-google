import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Loader2, User, Lock, Eye, EyeOff, ArrowLeft, Delete, 
  ShieldCheck, ShoppingBag, Truck, KeyRound, Sparkles, UserCheck, Check
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';

const roleMeta = {
  admin: {
    label: 'Administrador',
    icon: ShieldCheck,
    badgeBg: 'bg-[#501122]/10 text-[#501122] border-[#501122]/20',
    avatarBg: 'bg-[#501122] text-white',
  },
  vendedor: {
    label: 'Vendedor',
    icon: ShoppingBag,
    badgeBg: 'bg-[#C27A29]/10 text-[#C27A29] border-[#C27A29]/20',
    avatarBg: 'bg-[#C27A29] text-white',
  },
  delivery: {
    label: 'Repartidor',
    icon: Truck,
    badgeBg: 'bg-[#3F634A]/10 text-[#3F634A] border-[#3F634A]/20',
    avatarBg: 'bg-[#3F634A] text-white',
  },
};

export default function LoginPage() {
  const [team, setTeam] = useState([]);
  const [loadingTeam, setLoadingTeam] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  const [pin, setPin] = useState('');
  const [showPinText, setShowPinText] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pinError, setPinError] = useState(false);
  const [isManualMode, setIsManualMode] = useState(false);

  // Manual fallback inputs
  const [manualUsername, setManualUsername] = useState('');
  const [manualPassword, setManualPassword] = useState('');

  const { login } = useAuth();
  const navigate = useNavigate();

  // Fetch team members from public endpoint
  useEffect(() => {
    let isMounted = true;
    const fetchTeam = async () => {
      try {
        const { data } = await api.get('/public/team');
        if (isMounted) {
          setTeam(data || []);
        }
      } catch (err) {
        console.error('Error loading team for login:', err);
      } finally {
        if (isMounted) setLoadingTeam(false);
      }
    };
    fetchTeam();
    return () => { isMounted = false; };
  }, []);

  // Handle Login submission
  const executeLogin = useCallback(async (username, password) => {
    if (loading) return;
    setLoading(true);
    setPinError(false);
    try {
      const user = await login(username, password);
      toast.success(`¡Bienvenido, ${user.name}!`);
      const targetRoute = { admin: '/admin', vendedor: '/vendor', delivery: '/delivery' }[user.role] || '/';
      navigate(targetRoute);
    } catch (err) {
      setPinError(true);
      setPin('');
      const msg = err.response?.data?.detail || 'Contraseña incorrecta';
      toast.error(msg);
      setTimeout(() => setPinError(false), 1200);
    } finally {
      setLoading(false);
    }
  }, [login, navigate, loading]);

  // Keypad digit press
  const handleKeyPress = useCallback((digit) => {
    if (loading) return;
    setPin(prev => {
      if (prev.length >= 8) return prev;
      const nextPin = prev + digit;
      if (nextPin.length === 4 && selectedUser) {
        setTimeout(() => executeLogin(selectedUser.username, nextPin), 150);
      }
      return nextPin;
    });
  }, [loading, selectedUser, executeLogin]);

  // Backspace key
  const handleBackspace = useCallback(() => {
    if (loading) return;
    setPin(prev => prev.slice(0, -1));
  }, [loading]);

  // Clear PIN
  const handleClearPin = useCallback(() => {
    if (loading) return;
    setPin('');
  }, [loading]);

  // Hardware keyboard event listener
  useEffect(() => {
    if (!selectedUser || isManualMode) return;

    const handleKeyDown = (e) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        handleBackspace();
      } else if (e.key === 'Escape') {
        setSelectedUser(null);
        setPin('');
      } else if (e.key === 'Enter' && pin.length > 0) {
        executeLogin(selectedUser.username, pin);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedUser, isManualMode, pin, handleKeyPress, handleBackspace, executeLogin]);

  // Manual form submit
  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualUsername || !manualPassword) return;
    executeLogin(manualUsername, manualPassword);
  };

  return (
    <div className="min-h-screen bg-[#FBF7F0] flex flex-col md:flex-row text-[#1F1517]">
      {/* Main Interactive Login Panel */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 md:p-10 min-h-screen overflow-y-auto">
        <div className="w-full max-w-lg my-auto space-y-6">
          {/* Header Branding */}
          <div className="text-center sm:text-left flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-[#501122]/10 pb-5">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="Lubo's Tiramisú" className="h-9 w-auto" />
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#501122]/5 text-[#501122] text-xs font-bold border border-[#501122]/10">
              <Sparkles className="h-3.5 w-3.5 text-[#C27A29]" />
              <span>Sistema de Gestión</span>
            </div>
          </div>

          {/* VIEW 1: Team Member Selection Grid */}
          {!selectedUser && !isManualMode && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div>
                <h1 className="font-heading text-2xl sm:text-3xl text-[#501122] tracking-tight">
                  ¿Quién está ingresando?
                </h1>
                <p className="text-[#78686C] mt-1 text-sm">
                  Selecciona tu perfil de equipo para iniciar sesión
                </p>
              </div>

              {loadingTeam ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-[#78686C]">
                  <Loader2 className="h-8 w-8 animate-spin text-[#501122]" />
                  <span className="text-xs font-medium">Cargando equipo...</span>
                </div>
              ) : team.length === 0 ? (
                <div className="p-8 text-center bg-white rounded-3xl border border-[#501122]/10 shadow-sm space-y-3">
                  <UserCheck className="h-10 w-10 text-[#78686C] mx-auto opacity-50" />
                  <p className="text-sm font-semibold text-[#501122]">No hay usuarios en el equipo</p>
                  <Button 
                    onClick={() => setIsManualMode(true)}
                    className="bg-[#501122] text-white rounded-full text-xs"
                  >
                    Ingresar manualmente
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-2 gap-3.5 sm:gap-4">
                  {team.map((member) => {
                    const meta = roleMeta[member.role] || roleMeta.vendedor;
                    const RoleIcon = meta.icon;
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => {
                          setSelectedUser(member);
                          setPin('');
                          setPinError(false);
                        }}
                        data-testid={`team-card-${member.username}`}
                        className="group relative bg-white hover:bg-[#501122]/[0.02] border border-[#501122]/12 hover:border-[#501122]/40 rounded-3xl p-4 sm:p-5 text-left transition-all duration-200 shadow-sm hover:shadow-md hover:-translate-y-1 active:scale-98 flex flex-col justify-between gap-3 min-h-[140px]"
                      >
                        {/* Member Avatar */}
                        <div className="flex items-center justify-between">
                          {member.photo_data_url ? (
                            <img
                              src={member.photo_data_url}
                              alt={member.name}
                              className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover border-2 border-white shadow-sm ring-2 ring-[#501122]/10 group-hover:ring-[#501122]/30 transition-all"
                            />
                          ) : (
                            <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl ${meta.avatarBg} shadow-sm font-heading text-xl sm:text-2xl font-bold flex items-center justify-center border-2 border-white ring-2 ring-[#501122]/10 group-hover:ring-[#501122]/30 transition-all`}>
                              {member.name ? member.name.charAt(0).toUpperCase() : '?'}
                            </div>
                          )}

                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border ${meta.badgeBg}`}>
                            <RoleIcon className="h-3 w-3 shrink-0" />
                            <span className="hidden sm:inline">{meta.label}</span>
                          </span>
                        </div>

                        {/* Member Info */}
                        <div>
                          <h3 className="font-heading text-base sm:text-lg text-[#501122] font-bold line-clamp-1 group-hover:text-[#3D0C19]">
                            {member.name}
                          </h3>
                          <p className="text-[11px] text-[#78686C] font-mono capitalize">
                            @{member.username}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Bottom Toggle to Manual Mode */}
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => setIsManualMode(true)}
                  data-testid="switch-manual-login"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#501122] hover:underline p-2 rounded-xl transition-all"
                >
                  <Lock className="h-3.5 w-3.5 text-[#C27A29]" />
                  <span>Ingresar manualmente con usuario y contraseña</span>
                </button>
              </div>
            </div>
          )}

          {/* VIEW 2: Selected User Numeric Keypad / PIN Screen */}
          {selectedUser && !isManualMode && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
              {/* Navigation Back Header */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUser(null);
                    setPin('');
                    setPinError(false);
                  }}
                  data-testid="back-to-team-btn"
                  className="inline-flex items-center gap-2 text-xs font-bold text-[#501122] hover:bg-[#501122]/5 px-3 py-1.5 rounded-full transition-all border border-[#501122]/15 bg-white shadow-xs"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Cambiar de usuario</span>
                </button>

                <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-[#78686C]">
                  Teclado PIN
                </span>
              </div>

              {/* Selected User Header Card */}
              <div className="bg-white rounded-3xl p-4 sm:p-5 border border-[#501122]/15 shadow-sm flex items-center gap-4">
                {selectedUser.photo_data_url ? (
                  <img
                    src={selectedUser.photo_data_url}
                    alt={selectedUser.name}
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-white ring-2 ring-[#501122]/15 shadow-sm shrink-0"
                  />
                ) : (
                  <div className={`w-16 h-16 rounded-2xl ${roleMeta[selectedUser.role]?.avatarBg || 'bg-[#501122] text-white'} shadow-sm font-heading text-2xl font-bold flex items-center justify-center border-2 border-white ring-2 ring-[#501122]/15 shrink-0`}>
                    {selectedUser.name ? selectedUser.name.charAt(0).toUpperCase() : '?'}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-xl text-[#501122] font-bold truncate">
                      {selectedUser.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${roleMeta[selectedUser.role]?.badgeBg}`}>
                      {roleMeta[selectedUser.role]?.label || selectedUser.role}
                    </span>
                    <span className="text-xs text-[#78686C] font-mono">
                      @{selectedUser.username}
                    </span>
                  </div>
                </div>
              </div>

              {/* PIN Indicator Box */}
              <div className="text-center space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-[#78686C]">
                  Ingresa tu contraseña (PIN)
                </p>

                {/* 4 Digit Dots Indicator */}
                <div className={`flex justify-center items-center gap-3 py-2 ${pinError ? 'animate-bounce text-red-500' : ''}`}>
                  {[0, 1, 2, 3].map((index) => {
                    const isFilled = pin.length > index;
                    const digitChar = pin[index];
                    return (
                      <div
                        key={index}
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold border-2 transition-all duration-200 shadow-xs ${
                          pinError
                            ? 'border-red-500 bg-red-50 text-red-600'
                            : isFilled
                            ? 'border-[#501122] bg-[#501122] text-white scale-105'
                            : 'border-[#501122]/20 bg-white text-transparent'
                        }`}
                      >
                        {isFilled ? (showPinText ? digitChar : '•') : ''}
                      </div>
                    );
                  })}
                </div>

                {pinError && (
                  <p className="text-xs font-bold text-red-600 animate-in fade-in">
                    Contraseña incorrecta. Intenta nuevamente.
                  </p>
                )}
              </div>

              {/* Numeric Keypad (3x4 Grid) */}
              <div className="bg-white/80 backdrop-blur-md rounded-3xl p-4 border border-[#501122]/15 shadow-md max-w-xs mx-auto">
                <div className="grid grid-cols-3 gap-2.5">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      disabled={loading}
                      onClick={() => handleKeyPress(digit)}
                      data-testid={`keypad-${digit}`}
                      className="h-14 sm:h-16 rounded-2xl bg-white hover:bg-[#501122]/10 active:bg-[#501122] active:text-white border border-[#501122]/15 text-[#501122] text-2xl font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center font-mono disabled:opacity-50"
                    >
                      {digit}
                    </button>
                  ))}

                  {/* Toggle Show Text */}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setShowPinText(v => !v)}
                    title={showPinText ? 'Ocultar PIN' : 'Ver PIN'}
                    data-testid="keypad-toggle-pin"
                    className="h-14 sm:h-16 rounded-2xl bg-[#F3EBE0] hover:bg-[#E2D4C3] text-[#501122] text-sm font-bold border border-[#501122]/10 active:scale-95 transition-all flex items-center justify-center"
                  >
                    {showPinText ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>

                  {/* Zero Key */}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleKeyPress('0')}
                    data-testid="keypad-0"
                    className="h-14 sm:h-16 rounded-2xl bg-white hover:bg-[#501122]/10 active:bg-[#501122] active:text-white border border-[#501122]/15 text-[#501122] text-2xl font-bold shadow-xs active:scale-95 transition-all flex items-center justify-center font-mono disabled:opacity-50"
                  >
                    0
                  </button>

                  {/* Backspace Key */}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={handleBackspace}
                    title="Borrar último dígito"
                    data-testid="keypad-backspace"
                    className="h-14 sm:h-16 rounded-2xl bg-[#501122]/5 hover:bg-[#501122]/15 text-[#501122] border border-[#501122]/15 active:scale-95 transition-all flex items-center justify-center"
                  >
                    <Delete className="h-6 w-6" />
                  </button>
                </div>

                {/* Submit Action Button */}
                <div className="mt-3">
                  <Button
                    type="button"
                    disabled={loading || pin.length === 0}
                    onClick={() => executeLogin(selectedUser.username, pin)}
                    data-testid="keypad-submit-btn"
                    className="w-full h-12 bg-[#501122] hover:bg-[#3D0C19] text-white rounded-2xl font-bold text-sm shadow-md active:scale-98 transition-all flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Check className="h-4 w-4" />
                        <span>Entrar ({selectedUser.name})</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 3: Standard Manual Fallback Input */}
          {isManualMode && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => {
                    setIsManualMode(false);
                    setSelectedUser(null);
                  }}
                  data-testid="back-to-team-from-manual"
                  className="inline-flex items-center gap-2 text-xs font-bold text-[#501122] hover:bg-[#501122]/5 px-3 py-1.5 rounded-full transition-all border border-[#501122]/15 bg-white shadow-xs"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Volver a la lista del equipo</span>
                </button>
              </div>

              <div>
                <h1 className="font-heading text-2xl sm:text-3xl text-[#501122] tracking-tight">
                  Ingreso manual
                </h1>
                <p className="text-[#78686C] mt-1 text-sm">
                  Introduce tu usuario y contraseña completos
                </p>
              </div>

              <form onSubmit={handleManualSubmit} className="space-y-4" autoComplete="on">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#78686C]">Usuario</label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#78686C]" />
                    <Input
                      type="text"
                      value={manualUsername}
                      onChange={(e) => setManualUsername(e.target.value)}
                      required
                      placeholder="usuario"
                      autoComplete="username"
                      className="bg-white border-[#501122]/15 text-[#1F1517] rounded-2xl h-12 pl-11 pr-4 focus-visible:ring-2 focus-visible:ring-[#501122]/20"
                      data-testid="login-username-input"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-[#78686C]">Contraseña</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#78686C]" />
                    <Input
                      type={showPinText ? 'text' : 'password'}
                      value={manualPassword}
                      onChange={(e) => setManualPassword(e.target.value)}
                      required
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="bg-white border-[#501122]/15 text-[#1F1517] rounded-2xl h-12 pl-11 pr-12 focus-visible:ring-2 focus-visible:ring-[#501122]/20"
                      data-testid="login-password-input"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPinText(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-[#78686C] hover:text-[#501122]"
                    >
                      {showPinText ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  data-testid="login-submit-btn"
                  className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-bold text-base shadow-md active:scale-98 transition-all"
                >
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Iniciar Sesión'}
                </Button>
              </form>
            </div>
          )}

          <p className="text-[10px] text-[#78686C] text-center tracking-widest uppercase font-mono pt-4">
            Lubo's Tiramisú · Sistema de Gestión v2.0
          </p>
        </div>
      </div>

      {/* Decorative Branding Side Panel (Desktop / Tablet) */}
      <div className="hidden lg:block lg:w-[45%] relative overflow-hidden">
        <div className="absolute inset-0 bg-[#501122]">
          <img
            src="https://images.unsplash.com/photo-1605487821592-1d9b47fd9957?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHx0aXJhbWlzdSUyMGRlc3NlcnQlMjBmbGF0bGF5fGVufDB8fHx8MTc3ODQ2NDkwN3ww&ixlib=rb-4.1.0&q=85"
            alt="Lubo's Tiramisú"
            className="w-full h-full object-cover opacity-50 mix-blend-luminosity"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#501122] via-[#501122]/40 to-transparent" />
          
          <div className="absolute bottom-12 left-10 right-10 text-white space-y-3">
            <img src="/isotipo.webp" alt="Lubo's" className="h-16 w-auto mb-2" />
            <h2 className="font-heading text-3xl font-bold tracking-tight">
              Gestión de Entregas & Pedidos
            </h2>
            <p className="text-white/80 text-sm leading-relaxed max-w-md">
              Accede a tu panel personalizado para gestionar pedidos, delivery en mapa interactivo y métricas en tiempo real.
            </p>

            <div className="pt-4 border-t border-white/10 flex items-center gap-4 text-xs font-medium text-white/70">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-[#C27A29]" /> Admin
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <ShoppingBag className="h-4 w-4 text-[#C27A29]" /> Ventas
              </span>
              <span>•</span>
              <span className="flex items-center gap-1.5">
                <Truck className="h-4 w-4 text-[#C27A29]" /> Delivery
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
