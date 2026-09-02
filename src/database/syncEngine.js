// src/database/syncEngine.js
// Moteur de synchronisation EduKraft v3 (v1.1.7 — offline-first complet)
//
// PUSH (montée) — les données locales vers le serveur :
//   1. Chaque écriture locale (DbProvider) enqueue dans sync_queue
//   2. Ce moteur vérifie la file toutes les 30s quand online
//   3. Envoie un batch > le serveur traite et renvoie les résultats
//   4. Pour les badges : récupère le tx hash blockchain du serveur
//   5. Supprime les entrées syncées de la file
//   + v1.1.7 : sync IMMÉDIATE au retour du réseau (poll 5s pendant l'offline)
//     et au retour au premier plan (AppState 'active') — plus d'attente de
//     30s après une reconnexion, l'exigence étant « à la prochaine connexion
//     à Internet, ses données locales doivent être synchronisées en ligne ».
//
// PULL (descente) — v1.1.7 :
//   - Toutes les 5 min (et à chaque premier-plan / reconnexion) : pull de
//     l'état du compte (fusion MAX anti-rétrograde via restoreFromServer)
//     → les activités faites sur un AUTRE appareil apparaissent.
//   - Rafraîchissement du catalogue de cours distant (GET /api/content/modules)
//     → les nouveaux cours publiés sur le serveur apparaissent dans l'app
//     sans mise à jour de l'APK (cache AsyncStorage pour l'offline).

import { useEffect, useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { useDb } from './DbProvider';
import ENV from '../config/env';
import * as authService from '../services/authService';
import { refreshRemoteModules } from '../content/moduleRegistry';

const PULL_INTERVAL_MS = 5 * 60 * 1000; // pull serveur toutes les 5 min
const OFFLINE_POLL_MS  = 5 * 1000;      // poll réseau rapide quand offline

// ── Hook principal ────────────────────────────────────────────────────────────
export function useSyncEngine() {
  const db            = useDb();
  const timerRef      = useRef(null);
  const isSyncingRef  = useRef(false);
  const lastPullRef   = useRef(0);
  const wasOnlineRef  = useRef(true);
  const [syncState, setSyncState] = useState('idle'); // idle | syncing | error
  const [lastSync, setLastSync]   = useState(null);
  const [lastPull, setLastPull]   = useState(null);
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

      console.log(`[Sync] ${queue.length} opération(s) en attente > envoi batch`);

      // v1.1.12 : DÉDUPLICATION du batch — pour chaque (table, record_id) on
      // ne garde que la DERNIÈRE valeur : les ops learner/module_progress/
      // streak_log/daily_goal portent des LIGNES COMPLÈTES (les anciennes
      // versions sont toujours surpassées). Avant, chaque pull re-enfilait
      // une op learner AVEC LA PHOTO (250 Ko) : 8+ ops en file → un POST de
      // plusieurs Mo → HTTP 413 (express limit 2mb) → `throw` AVANT tout
      // traitement per-op → aucun retry incrémenté → la file restait bloquée
      // À VIE : la photo (et tout ce qui suivait) ne partait jamais.
      // NB : quiz_attempt porte un record_id unique par tentative → aucune
      // déduplication de ces événements ; badge est stable par module → la
      // dernière version gagne (le serveur upsert par learner+module).
      const byKey = new Map();
      for (const item of queue) {
        byKey.set(`${item.table_name}|${item.record_id}`, item);
      }
      const deduped = [...byKey.values()];
      // L'op learner passe en TÊTE du batch (elle crée la ligne serveur
      // client_id=lrn_<user.id> + fusion d'orphelins dont dépendent les ops
      // suivantes : module_progress, quiz, badges…).
      const learnerOps = deduped.filter(i => i.table_name === 'learner');
      const otherOps  = deduped.filter(i => i.table_name !== 'learner');
      const sendItems = [...learnerOps, ...otherOps];
      if (sendItems.length < queue.length) {
        console.log(`[Sync] Batch dédupliqué : ${queue.length} → ${sendItems.length} op(s)`);
      }

      // Préparer le batch
      const operations = sendItems.map(item => ({
        table_name: item.table_name,
        operation:   item.operation,
        record_id:   item.record_id,
        payload:     typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload,
      }));

      // Envoyer au serveur (batch)
      // v1.1 : timeout 30s via AbortController — Render (free tier) s'endort
      // après 15 min d'inactivité et le premier appel peut prendre 15-30s ;
      // sans timeout, le fetch pouvait bloquer la boucle de sync indéfiniment.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(`${ENV.API_BASE}/api/sync`, {
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
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        // v1.1.12 : une erreur HTTP (413 payload, 429, 5xx) incrémentait
        // AUCUN retry (throw direct) → un batch déficient restait identique
        // et échouait AD VITAM, bloquant toute la file. Désormais on
        // incrémente les retries de chaque op : après SYNC_MAX_RETRIES la
        // boucle per-op les abandonnera et la file repartira.
        console.error(`[Sync] HTTP ${response.status} — retry des ${sendItems.length} op(s) : ${text.slice(0, 120)}`);
        for (const item of sendItems) {
          try {
            if (item.retry_count >= ENV.SYNC_MAX_RETRIES) {
              console.error(`[Sync] Abandon ${item.table_name}/${item.record_id} (HTTP ${response.status})`);
              await db.removeFromQueue(item.id);
            } else {
              await db.incrementRetry(item.id, `HTTP ${response.status}`);
            }
          } catch (_) {}
        }
        throw new Error(`HTTP ${response.status}: ${text.slice(0, 100)}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Erreur serveur inconnue');
      }

      // Traiter les résultats
      let processed = 0;
      const results = result.data?.results || [];

      for (let i = 0; i < sendItems.length; i++) {
        const item   = sendItems[i];
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
        // v1.1.13 : purger AUSSI les versions ANTERIEURES de cette même clé
        // (table, record_id, queued_at ≤ celle envoyée). La déduplication
        // ci-dessus n'envoie que la dernière valeur — mais les doublons créés
        // offline par plusieurs écritures du même enregistrement restaient
        // dans sync_queue à tout jamais (zombies : jamais envoyés, jamais
        // effacés, alors que GET_PENDING_QUEUE est LIMIT 50). Les rows PLUS
        // RÉCENTS (écriture pendant le POST en vol) sont préservés.
        if (db.removeQueueKey) {
          try { await db.removeQueueKey(item.table_name, item.record_id, item.queued_at); } catch (_) {}
        }
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
      console.log(`[Sync] ${processed}/${sendItems.length} synchronisé(s)`);
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

  // ── v1.1.7 : PULL (descente) ─────────────────────────────────────────────
  // Pull de l'état du compte (fusion MAX via restoreFromServer : activités
  // des autres appareils) + rafraîchissement du catalogue de cours distant.
  // Cadencé à PULL_INTERVAL_MS, forcé au premier plan et à la reconnexion.
  const pull = useCallback(async (force = false) => {
    const nowMs = Date.now();
    if (!force && nowMs - lastPullRef.current < PULL_INTERVAL_MS) return;
    lastPullRef.current = nowMs;

    // 1. État du compte (progressions multi-appareils)
    try {
      const stored = await authService.getStoredAuth();
      if (stored?.user && stored.accessToken && !stored.sessionEnded && db.restoreFromServer) {
        await db.restoreFromServer(stored.user);
        setLastPull(new Date().toISOString());
      }
    } catch (e) {
      // best-effort : le pull suivant retentera
      console.log('[Sync] Pull compte différé :', e.message);
    }

    // 2. Catalogue de cours distant (nouveaux cours publiés sur le serveur)
    try {
      await refreshRemoteModules();
    } catch (_) {}
  }, [db]);

  // Refs toujours à jour (les timers appellent les dernières versions)
  const syncRef = useRef(sync);
  const pullRef = useRef(pull);
  useEffect(() => { syncRef.current = sync; }, [sync]);
  useEffect(() => { pullRef.current = pull; }, [pull]);

  // ── Boucle principale : sync au démarrage + périodique ─────────────────────
  useEffect(() => {
    if (!db.ready) return;

    // Sync immédiate au démarrage (délai court pour laisser l'UI se rendre)
    const startTimer = setTimeout(() => {
      syncRef.current();
      pullRef.current(); // premier pull (cache catalogue déjà appliqué à l'init)
    }, 3000);

    // Sync périodique
    timerRef.current = setInterval(() => {
      syncRef.current();
      pullRef.current();
    }, ENV.SYNC_INTERVAL_MS);

    return () => {
      clearTimeout(startTimer);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [db.ready]);

  // ── v1.1.7 : détection de reconnexion (poll rapide pendant l'offline) ─────
  // Exigence : « à la prochaine connexion à Internet, ses données locales
  // doivent être synchronisées en ligne ». Quand le réseau revient, on ne
  // laisse PAS passer 30s : sync + pull immédiats.
  useEffect(() => {
    if (!db.ready) return;
    let stopped = false;

    const check = async () => {
      let online = true;
      try {
        const net = await Network.getNetworkStateAsync();
        online = !!net.isInternetReachable;
      } catch (_) {
        online = true; // module indisponible : supposer online (le fetch décidera)
      }
      if (stopped) return;
      if (wasOnlineRef.current && !online) {
        console.log('[Sync] Réseau perdu — passage en mode hors ligne');
      } else if (!wasOnlineRef.current && online) {
        console.log('[Sync] Réseau de retour — sync immédiate');
        syncRef.current();
        pullRef.current(true);
      }
      wasOnlineRef.current = online;
    };

    check();
    const poll = setInterval(check, OFFLINE_POLL_MS);
    return () => { stopped = true; clearInterval(poll); };
  }, [db.ready]);

  // ── v1.1.7 : sync au retour au premier plan (AppState) ────────────────────
  // L'utilisateur rouvre l'app depuis le sélecteur d'applications → les
  // données saisies hors ligne partent immédiatement + pull des màj.
  useEffect(() => {
    if (!db.ready) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncRef.current();
        pullRef.current(true);
      }
    });
    return () => sub.remove();
  }, [db.ready]);

  return {
    triggerSync: sync,
    triggerPull: pull,
    syncState,
    lastSync,
    lastPull,
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
