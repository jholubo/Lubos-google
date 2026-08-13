import React, { useState, useEffect } from 'react';
import { useJsApiLoader } from '@react-google-maps/api';
import { getLocalCache, setLocalCache } from '@/lib/cache';

// Shared loader config so the Google Maps script is loaded once across the app
export const GOOGLE_MAPS_LIBRARIES = ['visualization', 'geometry'];
export const BUILD_TIME_KEY = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_GOOGLE_MAPS_KEY) || '';

// Maracay, Aragua, Venezuela
export const DEFAULT_CENTER = { lat: 10.2469, lng: -67.5958 };
export const DEFAULT_ZOOM = 13;

export const MAP_STYLES = [
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

let isFetchingMapsKey = false;

// Preloads maps key & settings into internal storage at app startup
export function preloadGoogleMapsScript() {
  if (typeof window === 'undefined') return;
  if (window.google?.maps?.Map) return;

  const cachedKey = getLocalCache('maps_key', BUILD_TIME_KEY);
  if (!cachedKey && !isFetchingMapsKey) {
    isFetchingMapsKey = true;
    fetch('/api/public/maps-key')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data?.key) {
          setLocalCache('maps_key', data.key);
        }
      })
      .catch(() => {})
      .finally(() => {
        isFetchingMapsKey = false;
      });
  }
}

// Auto-run preload on import
preloadGoogleMapsScript();

function InternalLoader({ apiKey, children }) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'lubos-google-maps',
    googleMapsApiKey: apiKey,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  return children({ isLoaded, loadError });
}

export function SafeMapsLoader({ children }) {
  const initialKey = getLocalCache('maps_key') || BUILD_TIME_KEY || '';
  const [apiKey, setApiKey] = useState(initialKey);
  const [loadingKey, setLoadingKey] = useState(!initialKey);
  const [fetchError, setFetchError] = useState(null);

  useEffect(() => {
    if (window.google?.maps?.Map) {
      setLoadingKey(false);
      return;
    }

    if (initialKey) {
      setLoadingKey(false);
    }

    // Background refresh/fetch key
    fetch('/api/public/maps-key')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch maps key');
        return res.json();
      })
      .then(data => {
        if (data && data.key) {
          setApiKey(data.key);
          setLocalCache('maps_key', data.key);
        } else if (!initialKey) {
          setFetchError(new Error('GOOGLE_MAPS_KEY_MISSING'));
        }
        setLoadingKey(false);
      })
      .catch(err => {
        if (!initialKey) setFetchError(new Error('GOOGLE_MAPS_KEY_MISSING'));
        setLoadingKey(false);
      });
  }, [initialKey]);

  if (window.google?.maps?.Map) {
    return children({ isLoaded: true, loadError: null });
  }

  if (loadingKey && !apiKey) {
    return (
      <div className="flex items-center justify-center p-8 text-[#501122]/70 font-semibold text-sm">
        Cargando configuración de mapas...
      </div>
    );
  }

  const hasKey = Boolean(
    apiKey &&
    typeof apiKey === 'string' &&
    apiKey.trim() !== '' &&
    apiKey !== '""'
  );

  if (!hasKey) {
    return children({ isLoaded: false, loadError: fetchError || new Error('GOOGLE_MAPS_KEY_MISSING') });
  }

  return <InternalLoader apiKey={apiKey}>{children}</InternalLoader>;
}


