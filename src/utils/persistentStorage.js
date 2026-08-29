// src/utils/persistentStorage.js
// Stockage persistant UNIFIÉ — la brique qui garantit que les données de
// l'apprenant survivent au redémarrage sur TOUTES les plateformes.
//
// Pourquoi ce module existe (correctif v1.1.3) :
//   Avant, DbProvider faisait `require('@react-native-async-storage/async-storage')`
//   dans un try/catch. Sur Android/iOS cela fonctionne, mais SUR WEB le paquet
//   async-storage lève une exception au require (il attend le module natif
//   RNCAsyncStorage absent de react-native-web) → l'erreur était avalée →
//   RIEN n'était persisté → au rechargement de la page, l'écran Login
//   réapparaissait et le profil invité était perdu.
//
// Chaîne de résolution :
//   1. AsyncStorage (natif Android/iOS — stockage persistant dédié)
//   2. localStorage (web — survit au rechargement du navigateur)
//   3. Map mémoire (dernier recours — session courante uniquement)
//
// API identique à AsyncStorage : getItem / setItem / removeItem / multiGet.

let AsyncStorage = null;
try {
  AsyncStorage = require('@react-native-async-storage/async-storage');
} catch (_) {
  // Web : le paquet natif n'est pas résoluble → fallback localStorage ci-dessous
  AsyncStorage = null;
}

const hasLocalStorage = () =>
  typeof localStorage !== 'undefined' && localStorage !== null;

const memoryFallback = new Map();

async function getItem(key) {
  // 1. AsyncStorage (natif)
  if (AsyncStorage) {
    try {
      const v = await AsyncStorage.getItem(key);
      if (v !== null && v !== undefined) return v;
    } catch (_) {}
  }
  // 2. localStorage (web)
  if (hasLocalStorage()) {
    try {
      const v = localStorage.getItem(key);
      if (v !== null && v !== undefined) return v;
    } catch (_) {}
  }
  // 3. Mémoire
  return memoryFallback.has(key) ? memoryFallback.get(key) : null;
}

async function setItem(key, value) {
  let ok = false;
  // 1. AsyncStorage (natif)
  if (AsyncStorage) {
    try { await AsyncStorage.setItem(key, value); ok = true; } catch (_) {}
  }
  // 2. localStorage (web)
  if (hasLocalStorage()) {
    try { localStorage.setItem(key, value); ok = true; } catch (_) {}
  }
  // 3. Mémoire (toujours)
  memoryFallback.set(key, value);
  if (!ok && !AsyncStorage && !hasLocalStorage()) {
    console.warn('[storage] Aucun stockage persistant disponible (mémoire seule)');
  }
  return ok;
}

async function removeItem(key) {
  if (AsyncStorage) {
    try { await AsyncStorage.removeItem(key); } catch (_) {}
  }
  if (hasLocalStorage()) {
    try { localStorage.removeItem(key); } catch (_) {}
  }
  memoryFallback.delete(key);
}

async function multiGet(keys) {
  const entries = [];
  for (const k of keys) {
    entries.push([k, await getItem(k)]);
  }
  return entries;
}

/** True si au moins un backend persistant est opérationnel. */
export function isPersistent() {
  return !!AsyncStorage || hasLocalStorage();
}

export const persistentStorage = {
  getItem,
  setItem,
  removeItem,
  multiGet,
};

export default persistentStorage;
