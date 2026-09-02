// src/database/repositories/syncRepository.js
// Repository Sync — file d'attente (sync_queue) + métadonnées (sync_meta).
//
// Utilisé par DbProvider (enqueue) et SyncEngine (getPendingQueue, removeFromQueue, etc.).

import { makeId } from './baseRepository';

export function createSyncRepository(db, store) {
  const isMemory = () => !db;
  const { QUERIES } = require('../schema');

  /** Ajoute une opération dans la file de sync. */
  async function enqueue(tableName, operation, recordId, payload) {
    const queueId = makeId('sq');
    const now = new Date().toISOString();

    if (isMemory()) {
      store.syncQueue.push({
        id: queueId, table_name: tableName, record_id: recordId,
        operation, payload: JSON.stringify(payload),
        queued_at: now, retry_count: 0, last_error: null,
      });
      return;
    }

    await db.runAsync(QUERIES.ENQUEUE, [
      queueId, tableName, recordId, operation,
      JSON.stringify(payload), now,
    ]);
  }

  /** Récupère les opérations en attente (max 50, ordre FIFO). */
  async function getPendingQueue() {
    if (isMemory()) return store.syncQueue.slice(0, 50);
    return db.getAllAsync(QUERIES.GET_PENDING_QUEUE);
  }

  /** Supprime une opération de la file. */
  async function removeFromQueue(queueId) {
    if (isMemory()) {
      store.syncQueue = store.syncQueue.filter(s => s.id !== queueId);
      return;
    }
    await db.runAsync(QUERIES.DELETE_FROM_QUEUE, [queueId]);
  }

  /** v1.1.13 : supprime les ops d'une même clé (table, record_id) jusqu'à
   *  `queued_at` INCLUS. Après une sync RÉUSSIE, la version envoyée est la
   *  plus récente du moment de l'envoi : les versions antérieures (doublons
   *  créés offline par plusieurs écritures du même enregistrement) sont
   *  obsolètes. Avant ce correctif, la déduplication du batch ne les ENVOYAIT
   *  jamais… mais ne les EFFAÇAIT jamais non plus : elles s'accumulaient en
   *  zombies dans sync_queue (GET_PENDING_QUEUE est LIMIT 50 → à terme la
   *  file se saturait d'entrées mortes).
   *  NB : on ne touche JAMAIS aux rows plus récents que l'op envoyée — une
   *  écriture survenue PENDANT le POST en vol doit rester en file (course
   *  critique : sinon elle serait purgée sans jamais partir). */
  async function removeAllForKey(tableName, recordId, queuedAtInclusive) {
    if (isMemory()) {
      store.syncQueue = store.syncQueue.filter(
        s => !(s.table_name === tableName && s.record_id === recordId
              && (queuedAtInclusive == null || String(s.queued_at) <= String(queuedAtInclusive)))
      );
      return;
    }
    if (queuedAtInclusive == null) {
      await db.runAsync(
        'DELETE FROM sync_queue WHERE table_name = ? AND record_id = ?',
        [tableName, recordId]
      );
    } else {
      await db.runAsync(
        'DELETE FROM sync_queue WHERE table_name = ? AND record_id = ? AND queued_at <= ?',
        [tableName, recordId, queuedAtInclusive]
      );
    }
  }

  /** Incrémente le compteur de retry + enregistre l'erreur. */
  async function incrementRetry(queueId, errorMsg) {
    if (isMemory()) {
      const item = store.syncQueue.find(s => s.id === queueId);
      if (item) { item.retry_count = (item.retry_count || 0) + 1; item.last_error = errorMsg; }
      return;
    }
    await db.runAsync(QUERIES.INCREMENT_RETRY, [errorMsg, queueId]);
  }

  /** Récupère une métadonnée de sync. */
  async function getMeta(key) {
    if (isMemory()) return store.syncMeta[key] ?? null;
    const row = await db.getFirstAsync(QUERIES.GET_META, [key]);
    return row?.value ?? null;
  }

  /** Définit une métadonnée de sync. */
  async function setMeta(key, value) {
    if (isMemory()) { store.syncMeta[key] = String(value); return; }
    await db.runAsync(QUERIES.SET_META, [key, String(value)]);
  }

  return { enqueue, getPendingQueue, removeFromQueue, removeAllForKey, incrementRetry, getMeta, setMeta };
}
