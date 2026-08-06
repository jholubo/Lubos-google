import { useState, useEffect, useCallback, useRef } from 'react';
import { Trophy } from 'lucide-react';
import confetti from 'canvas-confetti';
import api, { formatUSD } from '@/lib/api';

const fireConfetti = (color) => {
  const end = Date.now() + 2000;
  const colors = color === 'blue'
    ? ['#3b82f6', '#60a5fa', '#1d4ed8', '#bfdbfe']
    : ['#a855f7', '#c084fc', '#7e22ce', '#e9d5ff'];
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors });
    confetti({ particleCount: 5, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
};

export default function RecordsBar() {
  const [data, setData] = useState(null);
  // Track previous broken state so we trigger the confetti ONLY on the transition.
  const lastDailyBrokenRef = useRef(false);
  const lastMonthlyBrokenRef = useRef(false);
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/dashboard/records');
      const d = r.data;
      // On the very first load, just initialize refs without celebration.
      if (!initializedRef.current) {
        lastDailyBrokenRef.current = !!d?.today?.broken;
        lastMonthlyBrokenRef.current = !!d?.month?.broken;
        initializedRef.current = true;
      } else {
        if (d?.today?.broken && !lastDailyBrokenRef.current) fireConfetti('blue');
        if (d?.month?.broken && !lastMonthlyBrokenRef.current) fireConfetti('purple');
        lastDailyBrokenRef.current = !!d?.today?.broken;
        lastMonthlyBrokenRef.current = !!d?.month?.broken;
      }
      setData(d);
    } catch { /* keep last data */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis); };
  }, [load]);

  if (!data) return null;
  const { today, month } = data;

  const dailyPct = today.record > 0 ? Math.min(100, (today.revenue / today.record) * 100) : 100;
  const monthlyPct = month.is_first_month ? 100 : (month.record > 0 ? Math.min(100, (month.revenue / month.record) * 100) : 100);
  const dailyBroken = today.broken;
  const monthlyBroken = month.broken;

  return (
    <div className="flex-1 min-w-0 max-w-md hidden md:flex flex-col gap-0.5 px-3" data-testid="records-bar">
      {/* Daily Record */}
      <div className="flex items-center gap-2" data-testid="record-daily">
        <span className="text-[9px] font-bold uppercase tracking-wider text-blue-600 w-9 shrink-0 flex items-center gap-0.5">
          {dailyBroken && <Trophy className="h-2.5 w-2.5" />}
          Hoy
        </span>
        <div className="flex-1 h-2.5 bg-blue-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-blue-500 transition-[width] duration-500 ${dailyBroken ? 'animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.9)]' : ''}`}
            style={{ width: `${dailyPct}%` }}
          />
        </div>
        <span className="text-[9px] font-semibold text-[#1F1517] tabular-nums shrink-0 whitespace-nowrap" title={today.record_date ? `Record: ${today.record_date}` : 'Sin record previo'}>
          {formatUSD(today.revenue)} <span className="text-[#78686C]">/ {today.record > 0 ? formatUSD(today.record) : '--'}</span>
        </span>
      </div>

      {/* Monthly Record */}
      <div className="flex items-center gap-2" data-testid="record-monthly">
        <span className="text-[9px] font-bold uppercase tracking-wider text-purple-600 w-9 shrink-0 flex items-center gap-0.5">
          {monthlyBroken && <Trophy className="h-2.5 w-2.5" />}
          Mes
        </span>
        <div className="flex-1 h-1.5 bg-purple-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full bg-purple-500 transition-[width] duration-500 ${monthlyBroken ? 'animate-pulse shadow-[0_0_10px_rgba(168,85,247,0.9)]' : ''}`}
            style={{ width: `${monthlyPct}%` }}
          />
        </div>
        <span className="text-[9px] font-semibold text-[#1F1517] tabular-nums shrink-0 whitespace-nowrap" title={month.record_month ? `Record: ${month.record_month}` : 'Primer mes'}>
          {formatUSD(month.revenue)} <span className="text-[#78686C]">/ {month.is_first_month ? 'definiendo' : formatUSD(month.record)}</span>
        </span>
      </div>
    </div>
  );
}
