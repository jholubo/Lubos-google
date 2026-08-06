import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, User, Lock, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(username, password);
      navigate({ admin: '/admin', vendedor: '/vendor', delivery: '/delivery' }[user.role] || '/');
      toast.success(`Bienvenido, ${user.name}`);
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Error de autenticacion');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#FBF7F0] flex flex-col md:flex-row">
      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-10">
            <img src="/logo.svg" alt="Lubo's" className="h-8 w-auto mb-6" />
            <h1 className="font-heading text-3xl md:text-4xl text-[#501122] tracking-tight">
              Bienvenido
            </h1>
            <p className="text-[#78686C] mt-2 text-sm">Inicia sesion para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5" autoComplete="on">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Usuario</label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#78686C]" />
                <Input type="text" value={username} onChange={(e) => setUsername(e.target.value)} required
                  placeholder="tu usuario" autoComplete="username" name="username"
                  className="bg-white border-[#501122]/15 text-[#1F1517] rounded-2xl h-12 pl-11 pr-4 focus-visible:ring-2 focus-visible:ring-[#501122]/20"
                  data-testid="login-username-input" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Contrasena</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-[#78686C]" />
                <Input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} required
                  placeholder="********" autoComplete="current-password" name="password"
                  className="bg-white border-[#501122]/15 text-[#1F1517] rounded-2xl h-12 pl-11 pr-12 focus-visible:ring-2 focus-visible:ring-[#501122]/20"
                  data-testid="login-password-input" />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-[#78686C] hover:text-[#501122] hover:bg-[#501122]/5 transition-all"
                  aria-label={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                  data-testid="login-toggle-password">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={loading}
              className="w-full bg-[#501122] hover:bg-[#3D0C19] text-white h-12 rounded-full font-semibold text-base transition-transform hover:-translate-y-0.5 active:scale-95 shadow-md"
              data-testid="login-submit-btn">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Iniciar Sesion'}
            </Button>
          </form>

          <p className="text-[10px] text-[#78686C] mt-8 text-center tracking-wider uppercase">
            Sistema de Gestion
          </p>
        </div>
      </div>

      <div className="hidden md:block md:w-[45%] lg:w-[50%] relative overflow-hidden">
        <div className="absolute inset-0 bg-[#501122] rounded-l-[3rem]">
          <img
            src="https://images.unsplash.com/photo-1605487821592-1d9b47fd9957?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2ODh8MHwxfHNlYXJjaHwyfHx0aXJhbWlzdSUyMGRlc3NlcnQlMjBmbGF0bGF5fGVufDB8fHx8MTc3ODQ2NDkwN3ww&ixlib=rb-4.1.0&q=85"
            alt="Tiramisu" className="w-full h-full object-cover opacity-60 mix-blend-luminosity" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#501122] via-[#501122]/30 to-transparent" />
          <div className="absolute bottom-12 left-10 right-10">
            <img src="/isotipo.webp" alt="Lubo's" className="h-14 w-auto mb-4" />
            <p className="text-white/90 font-heading text-2xl tracking-tight">Gestion de entregas</p>
            <p className="text-white/50 text-sm mt-1">Pedidos, clientes y delivery en un solo lugar</p>
          </div>
        </div>
      </div>
    </div>
  );
}
