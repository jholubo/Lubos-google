import { preloadGoogleMapsScript } from '@/lib/mapsLoader';

// Real-time synchronization service via Server-Sent Events (SSE) + BroadcastChannel
let eventSource = null;
let broadcastChannel = null;

// Initialize BroadcastChannel for sub-millisecond cross-tab communication
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel('lubos_app_sync');
    broadcastChannel.onmessage = (msg) => {
      if (msg.data && msg.data.event) {
        dispatchLocalEvent(msg.data.event, msg.data.payload);
      }
    };
  } catch (e) {
    console.warn('[dataSync] BroadcastChannel not supported or error:', e);
  }
}

function dispatchLocalEvent(eventType, payload) {
  try {
    if (eventType === 'orders_changed' || eventType === 'order_created' || eventType === 'order_updated') {
      window.dispatchEvent(new CustomEvent('lubos:orders-changed', { detail: payload }));
    }
    if (eventType === 'notifications_changed') {
      window.dispatchEvent(new CustomEvent('lubos:notifications-changed', { detail: payload }));
    }
    if (eventType === 'flavors_changed') {
      window.dispatchEvent(new CustomEvent('lubos:flavors-changed', { detail: payload }));
    }
    if (eventType === 'settings_changed') {
      window.dispatchEvent(new CustomEvent('lubos:settings-changed', { detail: payload }));
    }
    if (eventType === 'customers_changed') {
      window.dispatchEvent(new CustomEvent('lubos:customers-changed', { detail: payload }));
    }
    if (eventType === 'location_update' || eventType === 'driver_location_changed') {
      window.dispatchEvent(new CustomEvent('lubos:location_update', { detail: payload }));
    }
    window.dispatchEvent(new CustomEvent('lubos:data-updated', { detail: { event: eventType, payload } }));
  } catch (e) {
    console.warn('[dataSync] error dispatching event:', e);
  }
}

export function notifyLocalChange(eventType, payload = {}) {
  const fullPayload = typeof payload === 'object' && payload !== null ? payload : { value: payload };
  // 1. Dispatch locally in current window (preserves self: true for local optimistic updates)
  dispatchLocalEvent(eventType, fullPayload);

  // 2. Broadcast to other tabs on same device (strips self: true so other tabs know to sync)
  if (broadcastChannel) {
    try {
      const { self, ...broadcastPayload } = fullPayload;
      broadcastChannel.postMessage({ event: eventType, payload: broadcastPayload, timestamp: Date.now() });
    } catch (e) {
      console.warn('[dataSync] BroadcastChannel postMessage error:', e);
    }
  }
}

export function initDataSync() {
  if (typeof window === 'undefined') return;
  preloadGoogleMapsScript();
  if (eventSource) return; // already connected

  const backendUrl = (typeof process !== 'undefined' && process.env?.REACT_APP_BACKEND_URL) || 
                     (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) || '';
  const eventsUrl = `${backendUrl}/api/events`;

  function connect() {
    try {
      eventSource = new EventSource(eventsUrl);

      eventSource.onopen = () => {
        // console.log('[dataSync] SSE connection established');
      };

      eventSource.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.event && data.event !== 'connected' && data.event !== 'ping') {
            dispatchLocalEvent(data.event, data.payload);
          }
        } catch (err) {
          console.warn('[dataSync] SSE message parse error:', err);
        }
      };

      eventSource.onerror = () => {
        // Auto-reconnect managed by EventSource browser standard, but if closed, retry
        if (eventSource && eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();
          eventSource = null;
          setTimeout(connect, 3000);
        }
      };
    } catch (err) {
      console.warn('[dataSync] SSE initialization failed:', err);
      setTimeout(connect, 5000);
    }
  }

  connect();
}
