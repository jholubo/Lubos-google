import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';

const SOUND_URLS = {
  // Cash register for admin (new sales)
  new_sale: 'https://lubos.com.ve/wp-content/uploads/2026/06/caja-registradora.mp3',
  // Horn (bocina) for delivery assigned / order delivered
  new_order: 'https://lubos.com.ve/wp-content/uploads/2026/06/bocina.mp3',
  order_delivered: 'https://lubos.com.ve/wp-content/uploads/2026/06/bocina.mp3',
};

// Pre-loaded Audio elements (singletons) — survive component re-mounts
const audioPool = {};
function getAudio(type) {
  if (!audioPool[type]) {
    const a = new Audio(SOUND_URLS[type] || SOUND_URLS.new_order);
    a.preload = 'auto';
    a.volume = 1.0;
    // Safari: playsinline avoids fullscreen video-player takeover on iOS
    try { a.setAttribute('playsinline', ''); } catch { /* ignore */ }
    // Load explicitly (Safari can be lazy about preloading cross-origin audio)
    try { a.load(); } catch { /* ignore */ }
    audioPool[type] = a;
  }
  return audioPool[type];
}

// Audio unlock state — once unlocked, sounds play freely
let audioUnlocked = false;
// Shared AudioContext (Safari/iOS: must be created + resumed inside a user gesture)
let sharedAudioCtx = null;
function getSharedAudioContext() {
  if (typeof window === 'undefined') return null;
  if (sharedAudioCtx) return sharedAudioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try { sharedAudioCtx = new AC(); } catch { return null; }
  return sharedAudioCtx;
}

function unlockAudio() {
  if (audioUnlocked) return;
  // Resume the shared AudioContext (required on Safari before any WebAudio can play)
  try {
    const ctx = getSharedAudioContext();
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      ctx.resume().catch(() => {});
    }
    // Also play a silent buffer to fully unlock Safari's audio pipeline
    if (ctx) {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      try { src.start(0); } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  // Try to play each mp3 silently to unlock <audio> playback on iOS/Android/Safari
  Object.keys(SOUND_URLS).forEach(t => {
    const a = getAudio(t);
    const prevVol = a.volume;
    a.volume = 0;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        a.pause();
        a.currentTime = 0;
        a.volume = prevVol;
      }).catch(() => { a.volume = prevVol; });
    }
  });
  audioUnlocked = true;
}

// Attach unlock to first user gesture (any click/touch/key). Retry until unlocked
// in case Safari's autoplay policy rejects the initial silent play.
if (typeof document !== 'undefined') {
  const handler = () => {
    unlockAudio();
    if (audioUnlocked) {
      document.removeEventListener('click', handler);
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('touchend', handler);
      document.removeEventListener('keydown', handler);
    }
  };
  document.addEventListener('click', handler, { passive: true });
  document.addEventListener('touchstart', handler, { passive: true });
  document.addEventListener('touchend', handler, { passive: true });
  document.addEventListener('keydown', handler, { passive: true });
}

function isSoundEnabled() {
  try {
    return localStorage.getItem('lubos-sound-enabled') !== 'false';
  } catch {
    return true;
  }
}

// Global guard: prevents the same sound from playing multiple times when the hook
// is mounted by several components in parallel (Layout + Dashboard) for the same event.
const recentlyPlayed = { key: null, ts: 0 };
function shouldPlay(notifIds, type) {
  // Key = sorted ids + type. If same key fired in the last 3 seconds, skip.
  const key = type + ':' + [...notifIds].sort().join(',');
  const now = Date.now();
  if (recentlyPlayed.key === key && now - recentlyPlayed.ts < 3000) {
    return false;
  }
  recentlyPlayed.key = key;
  recentlyPlayed.ts = now;
  return true;
}

function playSynthBell() {
  if (!isSoundEnabled()) return;
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    // Safari: ensure context is not suspended (needs a prior user gesture to allow resume)
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try { ctx.resume(); } catch { /* ignore */ }
    }
    const now = ctx.currentTime;
    // Two short bell tones (E6 then C6) to evoke a "piiin" ring.
    const tones = [
      { freq: 1318.5, start: 0,    dur: 0.6 },
      { freq: 1046.5, start: 0.18, dur: 0.7 },
    ];
    tones.forEach(t => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(t.freq, now + t.start);
      gain.gain.setValueAtTime(0.0001, now + t.start);
      gain.gain.exponentialRampToValueAtTime(0.45, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.05);
    });
  } catch (e) {
    console.warn('[notif] synth bell error:', e?.message || e);
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([120, 60, 120]);
  } catch { /* not supported */ }
}

// WebAudio synth fallback for the "cash register" / "horn" sound when the MP3 fails
// (e.g. Safari blocks cross-origin autoplay). Distinct tone per type so admin/vendor
// can still tell events apart even if the CDN mp3 doesn't play.
function playSynthFallback(type) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      try { ctx.resume(); } catch { /* ignore */ }
    }
    const now = ctx.currentTime;
    const isSale = type === 'new_sale';
    // Cash register: two crisp high beeps. Horn: two low warm beeps.
    const tones = isSale
      ? [{ freq: 1600, start: 0, dur: 0.15 }, { freq: 2000, start: 0.12, dur: 0.25 }]
      : [{ freq: 440,  start: 0, dur: 0.30 }, { freq: 330,  start: 0.20, dur: 0.35 }];
    tones.forEach(t => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = isSale ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(t.freq, now + t.start);
      gain.gain.setValueAtTime(0.0001, now + t.start);
      gain.gain.exponentialRampToValueAtTime(0.35, now + t.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t.start + t.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t.start);
      osc.stop(now + t.start + t.dur + 0.05);
    });
  } catch (e) {
    console.warn('[notif] synth fallback error:', e?.message || e);
  }
}

function getCurrentRole() {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return JSON.parse(raw).role || null;
  } catch { return null; }
}

function playSound(type) {
  if (!isSoundEnabled()) return;
  let mp3Failed = false;
  try {
    const audio = getAudio(type);
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(e => {
        console.warn('[notif] audio play blocked, using synth fallback:', e?.message || e);
        mp3Failed = true;
        playSynthFallback(type);
      });
    }
  } catch (e) {
    console.warn('[notif] audio error, using synth fallback:', e?.message || e);
    mp3Failed = true;
    playSynthFallback(type);
  }
  // Safari sometimes returns undefined from play() (older) — if we couldn't confirm,
  // schedule a synth fallback in case nothing was heard. Cheap and inaudible if MP3 plays.
  if (!mp3Failed) {
    // no-op: MP3 promise-based path handles fallback on rejection
  }
  // Vibration for mobile devices when sound might not be audible (pocket)
  try {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      // Stronger pattern for new orders, lighter for delivered
      const pattern = type === 'new_order' ? [400, 150, 400, 150, 400] : [200, 100, 200];
      navigator.vibrate(pattern);
    }
  } catch { /* not supported */ }
}

// Public helper for components to trigger sounds on explicit user actions
// (e.g. cash register when admin clicks "Pagado").
export function playNotificationSound(type) { playSound(type); }

export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const knownIdsRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications');
      setNotifications(data);
      const newUnreadCount = data.filter(n => !n.read).length;
      setUnreadCount(newUnreadCount);

      // Detect truly new unread notifications by ID (skip first load)
      const currentIds = new Set(data.map(n => n.id));
      if (knownIdsRef.current !== null) {
        const newOnes = data.filter(n => !knownIdsRef.current.has(n.id) && !n.read);
        if (newOnes.length > 0) {
          // Toast compacto en vivo para notificaciones entrantes
          newOnes.forEach(n => {
            if (n.message) {
              toast(n.message);
            }
          });

          const types = new Set(newOnes.map(n => n.type));
          // Cualquier evento relacionado con pedidos → refrescar pedidos ya (evento global).
          const ORDER_TYPES = new Set([
            'order_paid', 'order_delivered', 'order_reverted', 'new_sale',
            'order_available_for_delivery', 'order_released', 'order_assigned',
          ]);
          if ([...types].some(t => ORDER_TYPES.has(t))) {
            try { window.dispatchEvent(new CustomEvent('lubos:orders-changed')); } catch { /* ignore */ }
          }
          // Caja registradora (cash sound) cuando otro admin/vendedor marca "Pagado" un pedido.
          if (types.has('order_paid') && shouldPlay(newOnes.filter(n => n.type === 'order_paid').map(n => n.id), 'order_paid')) {
            playSound('new_sale');
          }
          // Bocina al recibir notificacion de "entrega completada" (para admin/vendor).
          if (types.has('order_delivered') && shouldPlay(newOnes.filter(n => n.type === 'order_delivered').map(n => n.id), 'order_delivered')) {
            playSound('order_delivered');
          }
          // Campanita (piin) cuando un pedido entra a "Disponibles" — solo para repartidores.
          const role = getCurrentRole();
          if (role === 'delivery') {
            const bellNotifs = newOnes.filter(n => n.type === 'order_available_for_delivery' || n.type === 'order_released');
            if (bellNotifs.length > 0 && shouldPlay(bellNotifs.map(n => n.id), 'bell')) {
              // Delivery LIBRE (sin pedidos en "Mis pedidos") -> suena caja registradora
              // para que sepa que hay un pedido que puede tomar.
              // Delivery OCUPADO -> piin corto para no distraer del que ya lleva.
              const freeFlag = typeof window !== 'undefined' && window.__lubosDeliveryFree;
              if (freeFlag) {
                playSound('new_sale');
              } else {
                playSynthBell();
              }
            }
          }
        }
      }
      knownIdsRef.current = currentIds;
    } catch (e) {
      console.warn('[useNotifications] fetch failed:', e?.message || e);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 5000);
    const onVisible = () => { if (document.visibilityState === 'visible') fetchNotifications(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', fetchNotifications);
    window.addEventListener('lubos:notifications-changed', fetchNotifications);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', fetchNotifications);
      window.removeEventListener('lubos:notifications-changed', fetchNotifications);
    };
  }, [fetchNotifications]);

  const markRead = async (id) => {
    await api.patch(`/notifications/${id}/read`);
    fetchNotifications();
  };

  const markAllRead = async () => {
    await api.patch('/notifications/read-all');
    fetchNotifications();
  };

  return { notifications, unreadCount, markRead, markAllRead, refresh: fetchNotifications };
}
