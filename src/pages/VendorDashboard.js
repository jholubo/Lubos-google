// Vendedor: reutiliza el AdminDashboard con role="vendor".
// El panel oculta secciones admin (Resumen, Finanzas, Config) y el boton de
// eliminar cliente. Todo lo demas (Nuevo pedido, Pedidos, Clientes) se comporta
// identico al panel del administrador.
import AdminDashboard from './AdminDashboard';

export default function VendorDashboard() {
  return <AdminDashboard role="vendor" />;
}
