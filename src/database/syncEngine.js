// src/database/syncEngine.js
// Moteur de synchronisation différentielle EduKraft
//
// Principe : chaque écriture locale enqueue un événement dans sync_queue.
// Quand le réseau revient, ce moteur vide la file par batch vers l'API REST.
// En cas d'erreur, retry exponentiel (max 5 tentatives).
//
// Statuts de sync par enregistrement :
//   pending  → modification locale non encore envoyée
//   synced   → confirmée par le serveur
//   error    → échec définitif après MAX_RETRIES

import { useEffect, useCallback, useRef } from 'react';
import * as Network from 'expo-network';
import { useDb } from './DbProvider';

const API_BASE       = 'https://api.edukraft.tg/v1'; // remplacer par variable env
const SYNC_INTERVAL  = 30_000;  // 30 secondes
const MAX_RETRIES    = 5;
const BATCH_SIZE     = 20;

// ── Hook principal ────────────────────────────────────────────────────────────
export function useSyncEngine() {
  const db            = useDb();
  const timerRef      = useRef(null);
  const isSyncingRef  = useRef(false);

  const sync = useCallback(async () => {
    if (isSyncingRef.current) return; // évite les chevauchements

    // Vérifier la connectivité
    const net = await Network.getNetworkStateAsync();
    if (!net.isInternetReachable) {
      console.log('[Sync] Hors ligne — sync différée');
      return;
    }

    isSyncingRef.current = true;
    let processed = 0;

    try {
      const queue = await db.getPendingQueue();
      if (queue.length === 0) {
        await db.setSyncMeta('last_sync_at', new Date().toISOString());
        return;
      }

      console.log(`[Sync] ${queue.length} élément(s) en attente`);

      // Traitement par batch
      const batch = queue.slice(0, BATCH_SIZE);

      for (const item of batch) {
        if (item.retry_count >= MAX_RETRIES) {
          // Abandon après MAX_RETRIES — log pour analyse
          console.error(`[Sync] Abandon définitif ${item.table_name}/${item.record_id}`);
          await db.removeFromQueue(item.id);
          continue;
        }

        try {
          const payload = JSON.parse(item.payload);
          await _sendToApi(item.table_name, item.operation, payload);
          await db.removeFromQueue(item.id);
          processed++;
        } catch (e) {
          const msg = e.message || 'Erreur inconnue';
          console.warn(`[Sync] Échec ${item.table_name}/${item.record_id} — retry ${item.retry_count + 1}/${MAX_RETRIES} : ${msg}`);
          await db.incrementRetry(item.id, msg);
        }
      }

      if (processed > 0) {
        await db.setSyncMeta('last_sync_at', new Date().toISOString());
        console.log(`[Sync] ${processed} élément(s) synchronisés`);
      }

    } catch (e) {
      console.error('[Sync] Erreur moteur :', e);
    } finally {
      isSyncingRef.current = false;
    }
  }, [db]);

  // Lancer la sync périodique
  useEffect(() => {
    if (!db.ready) return;

    // Sync immédiate au démarrage
    sync();

    // Sync périodique
    timerRef.current = setInterval(sync, SYNC_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [db.ready, sync]);

  return { triggerSync: sync };
}

// ── Envoi vers l'API REST ─────────────────────────────────────────────────────
async function _sendToApi(tableName, operation, payload) {
  const endpoint = _getEndpoint(tableName, operation, payload);
  const method   = operation === 'INSERT' ? 'POST' : 'PATCH';

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'X-Client':      'edukraft-mobile-v1',
      'X-Sync-Source': 'offline-queue',
    },
    body: JSON.stringify(_sanitize(tableName, payload)),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} : ${text.slice(0, 100)}`);
  }

  // Si c'est un badge : récupérer le tx hash Polygon retourné par l'API
  if (tableName === 'badge') {
    try {
      const data = await response.json();
      if (data?.blockchain_tx) {
        await useDb().updateBadgeTx(payload.id, data.blockchain_tx);
      }
    } catch (_) {}
  }
}

function _getEndpoint(tableName, operation, payload) {
  const MAP = {
    learner:          operation === 'INSERT' ? '/learners'                    : `/learners/${payload.id}`,
    module_progress:  operation === 'INSERT' ? '/progress'                    : `/progress/${payload.id}`,
    quiz_attempt:     '/quiz-attempts',
    badge:            '/badges',
  };
  return MAP[tableName] ?? `/${tableName}`;
}

// Supprime les colonnes internes avant envoi à l'API
function _sanitize(tableName, payload) {
  const { sync_status, updated_at, ...clean } = payload;
  return clean;
}

// ── Utilitaire : état de la connexion ─────────────────────────────────────────
export async function getNetworkStatus() {
  const state = await Network.getNetworkStateAsync();
  return {
    isOnline:   state.isInternetReachable,
    type:       state.type,            // wifi | cellular | none
    is2G:       state.type === 'cellular' && state.cellularGeneration === '2g',
  };
}
