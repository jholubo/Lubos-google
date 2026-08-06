import React from 'react';
import { useJsApiLoader } from '@react-google-maps/api';

// Shared loader config so the Google Maps script is loaded once across the app
export const GOOGLE_MAPS_LIBRARIES = ['visualization', 'geometry'];
export const GOOGLE_MAPS_API_KEY = (typeof process !== 'undefined' && process.env && process.env.REACT_APP_GOOGLE_MAPS_KEY) || '';

// Maracay, Aragua, Venezuela
export const DEFAULT_CENTER = { lat: 10.2469, lng: -67.5958 };
export const DEFAULT_ZOOM = 13;

export const MAP_STYLES = [
  { featureType: 'poi', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

function InternalLoader({ children }) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'lubos-google-maps',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY,
    libraries: GOOGLE_MAPS_LIBRARIES,
  });
  return children({ isLoaded, loadError });
}

export function SafeMapsLoader({ children }) {
  const hasKey = Boolean(
    GOOGLE_MAPS_API_KEY &&
    typeof GOOGLE_MAPS_API_KEY === 'string' &&
    GOOGLE_MAPS_API_KEY.trim() !== '' &&
    GOOGLE_MAPS_API_KEY !== '""'
  );

  if (!hasKey) {
    return children({ isLoaded: false, loadError: new Error('GOOGLE_MAPS_KEY_MISSING') });
  }

  return <InternalLoader>{children}</InternalLoader>;
}

