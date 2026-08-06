import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Trash2, ShieldAlert } from 'lucide-react';

// Password required to confirm destructive actions like deleting an order.
const ADMIN_PASS = '9422';

export default function PasswordConfirmDialog({ open, onOpenChange, onConfirm, title = 'Confirmar eliminacion', description, testId = 'password-confirm' }) {
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Reset state on open/close
  useEffect(() => { if (!open) { setPwd(''); setError(''); setBusy(false); } }, [open]);

  const handleConfirm = async () => {
    if (pwd !== ADMIN_PASS) { setError('Contrasena incorrecta'); return; }
    setBusy(true);
    try { await onConfirm(); onOpenChange(false); }
    catch (e) { setError(e?.message || 'Error al ejecutar'); }
    finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-red-300 rounded-[1.5rem] max-w-md" data-testid={testId}>
        <DialogHeader>
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-2">
            <ShieldAlert className="h-6 w-6 text-red-500" />
          </div>
          <DialogTitle className="text-[#501122] font-heading">{title}</DialogTitle>
          {description && <DialogDescription className="text-[#78686C]">{description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-[0.1em] text-[#78686C]">Contrasena de seguridad</Label>
            <Input
              type="password"
              value={pwd}
              onChange={(e) => { setPwd(e.target.value); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm(); }}
              placeholder="****"
              autoFocus
              className="bg-[#F3EBE0] border-[#501122]/10 h-12 rounded-2xl px-4 tracking-widest text-center text-lg font-bold"
              data-testid={`${testId}-input`}
            />
            {error && <p className="text-xs text-red-500 font-semibold" data-testid={`${testId}-error`}>{error}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1 border-[#501122]/15 text-[#501122] rounded-full h-11" data-testid={`${testId}-cancel`}>
              Cancelar
            </Button>
            <Button onClick={handleConfirm} disabled={busy || !pwd} className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-full h-11 font-semibold" data-testid={`${testId}-confirm`}>
              <Trash2 className="h-4 w-4 mr-1.5" />Eliminar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
