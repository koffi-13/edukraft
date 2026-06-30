// src/database/repositories/baseRepository.js
// Repository de base — fournit l'accès DB (SQLite natif ou MemoryStore fallback)
// et les helpers communs à tous les repositories.
//
// Pattern : chaque repository est une factory qui reçoit (db, store) et retourne
// un objet avec des méthodes async. Les repositories ne gèrent PAS l'état React
// (setLearner, etc.) — c'est DbProvider qui s'en charge.

const { v4: uuidv4 } = require('uuid');

let uuidLib = null;
try { uuidLib = require('uuid'); } catch (_) { uuidLib = null; }

export function makeId(prefix) {
  if (uuidLib && uuidLib.v4) return `${prefix}_${uuidLib.v4().slice(0, 12)}`;
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
