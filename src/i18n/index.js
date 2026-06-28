// src/i18n/index.js
// Moteur i18n léger — pas de dépendance externe, fallback FR, interpolation {{var}}

import fr  from './fr.json';
import ewe from './ewe.json';

const CATALOGS = { fr, ewe };

let _currentLang = 'fr';

// ── API publique ────────────────────────────────────────────────────────────

/**
 * Initialise la langue (appeler au démarrage ou changement de langue)
 * @param {'fr'|'ewe'} lang
 */
export function setLanguage(lang) {
  if (CATALOGS[lang]) {
    _currentLang = lang;
  } else {
    console.warn(`[i18n] Langue '${lang}' inconnue, fallback sur 'fr'`);
    _currentLang = 'fr';
  }
}

export function getLanguage() {
  return _currentLang;
}

/**
 * Traduit une clé dotée (ex: "lesson.complete") avec interpolation {{key}}
 * Fallback : clé manquante dans la langue courante → français → clé brute
 *
 * @param {string} key   - Chemin dotté dans le catalogue
 * @param {Object} vars  - Variables d'interpolation { count: 3, min: 2 }
 * @returns {string}
 */
export function t(key, vars = {}) {
  const value = _resolve(key, _currentLang)
    ?? _resolve(key, 'fr')
    ?? key;

  return _interpolate(value, vars);
}

// ── Internals ───────────────────────────────────────────────────────────────

function _resolve(key, lang) {
  const parts = key.split('.');
  let node = CATALOGS[lang];
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return null;
    node = node[part];
  }
  return typeof node === 'string' ? node : null;
}

function _interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{{${k}}}`
  );
}

// ── Catalogue disponibles pour le sélecteur de langue ──────────────────────
export const AVAILABLE_LANGUAGES = [
  { code: 'fr',  label: 'Français',       flag: '🇫🇷' },
  { code: 'ewe', label: 'Eʋegbe (Ewe)',   flag: '🇹🇬' },
];