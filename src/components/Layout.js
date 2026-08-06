import { useAuth } from '@/contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@/hooks/useNotifications';
import { LogOut } from 'lucide-react';
import Avatar from '@/components/Avatar';

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Keep the notifications hook subscribed so background sounds still fire on new events.
  useNotifications();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen bg-[#FBF7F0]">
      {/* Mobile-only top bar (desktop chrome lives in the sidebar of each dashboard) */}
      <header className="md:hidden sticky top-0 z-50 bg-[#FBF7F0]/90 backdrop-blur-xl border-b border-[#501122]/5 px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <img src="/logo.svg" alt="Lubo's" className="h-6 w-auto" data-testid="header-logo" />
          <div className="flex items-center gap-2">
            <Avatar src={user?.photo_data_url} name={user?.name} size={28} testId="mobile-header-avatar" />
            <button onClick={handleLogout} data-testid="mobile-logout-btn" className="h-8 w-8 flex items-center justify-center rounded-full text-[#501122] hover:bg-[#501122]/5">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>
      <main className="pb-24 md:pb-4 px-4 py-4 md:px-5 md:py-4">
        {children}
      </main>
    </div>
  );
}
