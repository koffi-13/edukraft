// src/database/repositories/baseRepository.js
// Repository de base — fournit l'accès DB (SQLite natif ou MemoryStore fallback)
// et les helpers communs à tous les repositories.
//
// Pattern : chaque repository est une factory qui reçoit (db, store) et retourne
// un objet avec des méthodes async. Les repositories ne gèrent PAS l'état React
// (setLearner, etc.) — c'est DbProvider qui s'en charge.

// ⚠️ Ne PAS utiliser le module `uuid` ici — il appelle crypto.getRandomValues()
// qui n'existe pas sur React Native / Hermes (erreur : "crypto.getRandomValues
// not supported"). On utilise un générateur d'ID maison basé sur Math.random()
// + Date.now(), suffisant pour des IDs locaux uniques (préfixe + timestamp + random).

/**
 * Génère un ID unique avec un préfixe.
 * Format : {prefix}_{timestamp_base36}{random_base36}
 * Ex : sq_lz3k2f8a1b2c
 */
export function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}`;
}

/**
 * Crée un repository de base avec accès db + store.
 * @param {Object|null} db - instance SQLite native (ou null en mode mémoire)
 * @param {Object} store - MemoryStore (référence mutable, partagée)
 * @param {Function} enqueue - fonction d'enqueue pour la sync (optionnelle)
 */
export function createBaseRepository(db, store, enqueue) {
  const isMemory = () => !db;

  /** Charge le QUERIES du schema (lazy, évite cycle d'import) */
  function queries() {
    return require('../schema').QUERIES;
  }

  return { isMemory, store, db, enqueue, queries, makeId };
}
