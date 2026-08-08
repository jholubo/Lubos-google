import { useState, useEffect, useCallback, useRef } from 'react';
import { Trophy } from 'lucide-react';
import confetti from 'canvas-confetti';
import api, { formatUSD } from '@/lib/api';
import { getLocalCache, setLocalCache } from '@/lib/cache';

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

export default function RecordsBar({ collapsed = false }) {
  const [data, setData] = useState(null);
  // Track previous broken state so we trigger the confetti ONLY on the transition.
  const lastDailyBrokenRef = useRef(false);
  const lastMonthlyBrokenRef = useRef(false);
  const initializedRef = useRef(false);

  const load = useCallback(async () => {
    // Instant cache read
    const cRec = getLocalCache('dashboard_records');
    if (cRec && !data) setData(cRec);

    try {
      const r = await api.get('/dashboard/records');
      const d = r.data;
      setLocalCache('dashboard_records', d);
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
  }, [data]);

  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('lubos:orders-changed', load);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('lubos:orders-changed', load);
    };
  }, [load]);

  if (!data) return null;
  const { today, month } = data;

  const dailyPct = today.record > 0 ? Math.min(100, (today.revenue / today.record) * 100) : 100;
  const monthlyPct = month.is_first_month ? 100 : (month.record > 0 ? Math.min(100, (month.revenue / month.record) * 100) : 100);
  const dailyBroken = today.broken;
  const monthlyBroken = month.broken;

  const todayTooltip = `Hoy: ${formatUSD(today.revenue)} / ${today.record > 0 ? formatUSD(today.record) : '--'} (${Math.round(dailyPct)}%)`;
  const monthTooltip = `Mes: ${formatUSD(month.revenue)} / ${month.is_first_month ? 'definiendo' : formatUSD(month.record)} (${Math.round(monthlyPct)}%)`;

  // Collapsed Sidebar View: Sleek Vertical Bars
  if (collapsed) {
    return (
      <div
        className="w-full flex flex-col items-center gap-1 py-2 px-1 bg-[#501122]/[0.03] hover:bg-[#501122]/[0.07] rounded-2xl border border-[#501122]/15 shadow-2xs transition-all cursor-default"
        data-testid="records-bar-collapsed"
        title={`${todayTooltip}\n${monthTooltip}`}
      >
        <div className="flex items-center justify-center text-[#501122]">
          <Trophy className="h-3.5 w-3.5 text-[#C27A29] shrink-0" />
        </div>

        {/* Taller Vertical Progress Bars Side-by-Side */}
        <div className="flex items-end justify-center gap-1.5 h-32 my-0.5">
          {/* Hoy Vertical Bar */}
          <div className="flex flex-col items-center gap-1 h-full w-3" title={todayTooltip}>
            <div className="relative w-2.5 flex-1 bg-amber-100/80 rounded-full overflow-hidden flex flex-col justify-end p-0.5 border border-amber-200/60 shadow-inner">
              <div
                className={`w-full rounded-full transition-[height] duration-500 ${
                  dailyBroken
                    ? 'bg-gradient-to-t from-amber-500 to-amber-300 animate-pulse shadow-[0_0_8px_rgba(217,138,50,0.9)]'
                    : 'bg-gradient-to-t from-[#C27A29] to-amber-400'
                }`}
                style={{ height: `${dailyPct}%` }}
              />
            </div>
            <span className="text-[9px] font-black text-[#C27A29] leading-none uppercase">H</span>
          </div>

          {/* Mes Vertical Bar */}
          <div className="flex flex-col items-center gap-1 h-full w-3" title={monthTooltip}>
            <div className="relative w-2.5 flex-1 bg-[#501122]/10 rounded-full overflow-hidden flex flex-col justify-end p-0.5 border border-[#501122]/20 shadow-inner">
              <div
                className={`w-full rounded-full transition-[height] duration-500 ${
                  monthlyBroken
                    ? 'bg-gradient-to-t from-[#501122] to-[#902244] animate-pulse shadow-[0_0_8px_rgba(80,17,34,0.9)]'
                    : 'bg-gradient-to-t from-[#501122] to-[#701C33]'
                }`}
                style={{ height: `${monthlyPct}%` }}
              />
            </div>
            <span className="text-[9px] font-black text-[#501122] leading-none uppercase">M</span>
          </div>
        </div>
      </div>
    );
  }

  // Expanded Sidebar View: Clean, minimal & compact card for Sales Records
  return (
    <div className="w-full flex flex-col gap-2 p-2.5 rounded-2xl bg-[#501122]/[0.03] border border-[#501122]/10" data-testid="records-bar">
      <div className="flex items-center justify-between text-xs font-bold text-[#501122]">
        <span className="flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5 text-[#C27A29]" />
          Récords de Ventas
        </span>
      </div>

      {/* Hoy */}
      <div className="space-y-1" data-testid="record-daily">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-[#501122] flex items-center gap-1">
            Hoy
            {dailyBroken && (
              <span className="text-[9px] font-bold text-amber-600">🏆</span>
            )}
          </span>
          <span className="font-bold text-[#1F1517] tabular-nums">
            {formatUSD(today.revenue)}
            <span className="text-[10px] text-[#78686C] font-normal"> / {today.record > 0 ? formatUSD(today.record) : '--'}</span>
          </span>
        </div>
        <div className="w-full h-1.5 bg-[#501122]/10 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              dailyBroken ? 'bg-amber-500 animate-pulse' : 'bg-[#C27A29]'
            }`}
            style={{ width: `${dailyPct}%` }}
          />
        </div>
      </div>

      {/* Mes */}
      <div className="space-y-1" data-testid="record-monthly">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-semibold text-[#501122] flex items-center gap-1">
            Mes
            {monthlyBroken && (
              <span className="text-[9px] font-bold text-purple-600">🏆</span>
            )}
          </span>
          <span className="font-bold text-[#1F1517] tabular-nums">
            {formatUSD(month.revenue)}
            <span className="text-[10px] text-[#78686C] font-normal"> / {month.is_first_month ? '---' : formatUSD(month.record)}</span>
          </span>
        </div>
        <div className="w-full h-1.5 bg-[#501122]/10 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              monthlyBroken ? 'bg-[#501122] animate-pulse' : 'bg-[#501122]/80'
            }`}
            style={{ width: `${monthlyPct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
