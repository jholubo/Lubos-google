import { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="bg-white rounded-[1.5rem] border border-red-200 p-8 text-center shadow-[0_8px_30px_rgba(80,17,34,0.03)]" data-testid="error-boundary-fallback">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-7 w-7 text-red-500" />
          </div>
          <h3 className="font-heading text-xl text-[#501122] mb-2">{this.props.title || 'Algo salio mal'}</h3>
          <p className="text-sm text-[#78686C] mb-1 max-w-md mx-auto">
            {this.props.message || 'Esta seccion tuvo un error inesperado. Puedes intentar recargar la pagina.'}
          </p>
          {this.state.error && (
            <p className="text-[10px] text-[#78686C]/70 mt-2 font-mono break-all max-w-md mx-auto">
              {String(this.state.error?.message || this.state.error).slice(0, 200)}
            </p>
          )}
          <button onClick={() => window.location.reload()} className="mt-5 inline-flex items-center gap-2 bg-[#501122] hover:bg-[#3D0C19] text-white rounded-full px-5 py-2.5 text-sm font-semibold transition-all shadow-md">
            <RefreshCw className="h-4 w-4" />Recargar pagina
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
