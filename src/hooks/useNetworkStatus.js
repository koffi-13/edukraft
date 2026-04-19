// src/hooks/useNetworkStatus.js
// Hook de surveillance réseau en temps réel
// Retourne : { isOnline, type, is2G, quality }

import { useState, useEffect, useRef } from 'react';
import * as Network from 'expo-network';

const POLL_INTERVAL = 5000; // 5 secondes

// Qualité de connexion estimée (utile pour adapter la sync)
function estimateQuality(state) {
  if (!state.isInternetReachable) return 'none';
  if (state.type === Network.NetworkStateType.WIFI) return 'good';
  const gen = state.cellularGeneration;
  if (gen === '4g') return 'good';
  if (gen === '3g') return 'fair';
  if (gen === '2g') return 'poor';
  return 'unknown';
}

export function useNetworkStatus() {
  const [status, setStatus] = useState({
    isOnline:  true,
    type:      'unknown',
    is2G:      false,
    quality:   'unknown',
    checked:   false,
  });
  const timerRef = useRef(null);

  const check = async () => {
    try {
      const state = await Network.getNetworkStateAsync();
      setStatus({
        isOnline: state.isInternetReachable !== false,
        type:     state.type ?? 'unknown',
        is2G:     state.type === Network.NetworkStateType.CELLULAR
                    && state.cellularGeneration === '2g',
        quality:  estimateQuality(state),
        checked:  true,
      });
    } catch {
      // Erreur de lecture réseau — considère offline par précaution
      setStatus(prev => ({ ...prev, isOnline: false, checked: true }));
    }
  };

  useEffect(() => {
    check();
    timerRef.current = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(timerRef.current);
  }, []);

  return status;
}
