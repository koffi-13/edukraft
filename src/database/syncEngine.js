// src/database/syncEngine.js
// Moteur de synchronisation différentielle EduKraft v2
//
// Utilise le endpoint batch POST /sync pour envoyer toutes les opérations
// en attente en une seule requête HTTP.
//
// Flux :
//   1. Chaque écriture locale (DbProvider) enqueue dans sync_queue
//   2. Ce moteur vérifie la file toutes les 30s quand online
//   3. Envoie un batch → le serveur traite et renvoie les résultats
//   4. Pour les badges : récupère le tx hash blockchain du serveur
//   5. Supprime les entrées syncées de la file

import { useEffect, useCallback, useRef, useState } from 'react';
import * as Network from 'expo-network';
import { useDb } from './DbProvider';
import ENV from '../config/env';

// ── Hook principal ────────────────────────────────────────────────────────────
export function useSyncEngine() {
  const db            = useDb();
  const timerRef      = useRef(null);
  const isSyncingRef  = useRef(false);
  const [syncState, setSyncState] = useState('idle'); // idle | syncing | error
  const [lastSync, setLastSync]   = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastError, setLastError] = useState(null);

  const sync = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setSyncState('syncing');

    try {
      // Vérifier la connectivité
      let isOnline = false;
      try {
        const net = await Network.getNetworkStateAsync();
        isOnline = !!net.isInternetReachable;
      } catch (_) {
        isOnline = false;
      }

      if (!isOnline) {
        console.log('[Sync] Hors ligne — sync différée');
        setSyncState('idle');
        isSyncingRef.current = false;
        return;
      }

      // Récupérer la file d'attente
      const queue = await db.getPendingQueue();
      setPendingCount(queue.length);

      if (queue.length === 0) {
        const now = new Date().toISOString();
        await db.setSyncMeta('last_sync_at', now);
        setLastSync(now);
        setSyncState('idle');
        isSyncingRef.current = false;
        return;
      }

      console.log(`[Sync] ${queue.length} opération(s) en attente → envoi batch`);

      // Préparer le batch
      const operations = queue.map(item => ({
        table_name: item.table_name,
        operation:   item.operation,
        record_id:   item.record_id,
        payload:     typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload,
      }));

      // Envoyer au serveur (batch)
      const response = await fetch(`${ENV.API_BASE}/api/sync`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'X-Client':      'edukraft-mobile-v1',
          'X-API-Key':     ENV.API_KEY,
        },
        body: JSON.stringify({
          operations,
          client_cursor: await db.getSyncMeta('sync_cursor') || '0',
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Erreur serveur inconnue');
      }

      // Traiter les résultats
      let processed = 0;
      const results = result.data?.results || [];

      for (let i = 0; i < queue.length; i++) {
        const item   = queue[i];
        const res    = results[i];

        if (!res || res.status === 'error') {
          const errMsg = res?.error || 'Erreur inconnue';
          if (item.retry_count >= ENV.SYNC_MAX_RETRIES) {
            console.error(`[Sync] Abandon ${item.table_name}/${item.record_id}: ${errMsg}`);
            await db.removeFromQueue(item.id);
          } else {
            console.warn(`[Sync] Retry ${item.table_name}/${item.record_id}: ${errMsg}`);
            await db.incrementRetry(item.id, errMsg);
          }
          continue;
        }

        // Sync réussie
        await db.removeFromQueue(item.id);
        processed++;

        // Si c'est un badge avec un tx hash blockchain, le stocker localement
        if (item.table_name === 'badge' && res.blockchain_tx) {
          try {
            await db.updateBadgeTx(item.record_id, res.blockchain_tx);
          } catch (_) {}
        }
      }

      // Mettre à jour les métadonnées
      const now = new Date().toISOString();
      await db.setSyncMeta('last_sync_at', now);
      if (result.data?.server_cursor) {
        await db.setSyncMeta('sync_cursor', result.data.server_cursor);
      }

      setLastSync(now);
      setPendingCount(0);
      setLastError(null);
      console.log(`[Sync] ${processed}/${queue.length} synchronisé(s)`);
    } catch (err) {
      console.error('[Sync] Erreur:', err.message);
      setLastError(err.message);
      setSyncState('error');
    } finally {
      isSyncingRef.current = false;
      // Retour à idle après un court délai si pas en erreur
      if (syncState !== 'error') {
        setTimeout(() => setSyncState('idle'), 1000);
      }
    }
  }, [db, syncState]);

  // Lancer la sync périodique
  useEffect(() => {
    if (!db.ready) return;

    // Sync immédiate au démarrage (délai court pour laisser l'UI se rendre)
    const startTimer = setTimeout(() => {
      sync();
    }, 3000);

    // Sync périodique
    timerRef.current = setInterval(sync, ENV.SYNC_INTERVAL_MS);

    return () => {
      clearTimeout(startTimer);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [db.ready, sync]);

  return {
    triggerSync: sync,
    syncState,
    lastSync,
    pendingCount,
    lastError,
  };
}

// ── Utilitaire : état de la connexion ─────────────────────────────────────────
export async function getNetworkStatus() {
  try {
    const state = await Network.getNetworkStateAsync();
    return {
      isOnline: !!state.isInternetReachable,
      type:     state.type || 'none',
    };
  } catch (_) {
    return { isOnline: false, type: 'none' };
  }
}