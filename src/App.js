import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Toaster } from '@/components/ui/sonner';
import Layout from '@/components/Layout';
import LoginPage from '@/pages/LoginPage';
import VendorDashboard from '@/pages/VendorDashboard';
import DeliveryDashboard from '@/pages/DeliveryDashboard';
import AdminDashboard from '@/pages/AdminDashboard';
import MapView from '@/pages/MapView';
import '@/App.css';

const roleRoutes = { admin: '/admin', vendedor: '/vendor', delivery: '/delivery' };

function ProtectedRoute({ children, allowedRoles }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="min-h-screen bg-[#F9F5E9] flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-[#4A2F22] border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!user) return <Navigate to="/login" />;
  if (allowedRoles && !allowedRoles.includes(user.role)) return <Navigate to={roleRoutes[user.role] || '/login'} />;
  return <Layout>{children}</Layout>;
}

function RoleRedirect() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" />;
  return <Navigate to={roleRoutes[user.role] || '/login'} />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<RoleRedirect />} />
          <Route path="/vendor" element={<ProtectedRoute allowedRoles={['vendedor']}><VendorDashboard /></ProtectedRoute>} />
          <Route path="/delivery" element={<ProtectedRoute allowedRoles={['delivery']}><DeliveryDashboard /></ProtectedRoute>} />
          <Route path="/admin" element={<ProtectedRoute allowedRoles={['admin']}><AdminDashboard /></ProtectedRoute>} />
          <Route path="/map-view" element={<ProtectedRoute allowedRoles={['admin','vendedor','delivery']}><MapView /></ProtectedRoute>} />
          <Route path="*" element={<RoleRedirect />} />
        </Routes>
      </BrowserRouter>
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}

export default App;
