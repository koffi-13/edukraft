// src/config/interests.js
// Centres d'intérêt de l'apprenant — codes partagés avec le CMS admin.
//
// Exigence : « accès par centres d'intérêt » — l'apprenant coche ses centres
// d'intérêt dans son profil (chips multi-select), la valeur est persistée en
// CSV de codes dans learner.interests (SQLite + sync), et le Dashboard
// remonte les modules correspondants dans « ⭐ Recommandé pour toi ».
//
// Les 10 codes ci-dessous correspondent EXACTEMENT aux intérêts du site
// d'administration (table Interest du CMS) — ne pas les renommer sans
// mettre à jour le CMS : le CSV serait silencieusement filtré.

// ── Les 10 centres d'intérêt (codes du CMS admin) ─────────────────────────
export const INTERESTS = [
  { code: 'technologie-numerique',     label: 'Technologie & Numérique',      emoji: '💻' },
  { code: 'commerce-vente',            label: 'Commerce & Vente',             emoji: '🛒' },
  { code: 'gestion-comptabilite',      label: 'Gestion & Comptabilité',       emoji: '📊' },
  { code: 'agriculture-transformation', label: 'Agriculture & Transformation', emoji: '🌾' },
  { code: 'transport-logistique',      label: 'Transport & Logistique',       emoji: '🚚' },
  { code: 'communication-medias',      label: 'Communication & Médias',       emoji: '📣' },
  { code: 'examens-concours',          label: 'Examens & Concours',           emoji: '🎓' },
  { code: 'mathematiques',             label: 'Mathématiques',                emoji: '➗' },
  { code: 'langues-lecture',           label: 'Langues & Lecture',            emoji: '📚' },
  { code: 'sciences',                  label: 'Sciences',                     emoji: '🔬' },
];

const VALID_CODES = new Set(INTERESTS.map(i => i.code));

// ── Sérialisation CSV (learner.interests) ──────────────────────────────────
// « commerce-vente,technologie-numerique » — codes invalides ignorés
// (un code retiré du CMS ne casse pas l'app), doublons retirés, ordre préservé.

/** CSV → tableau de codes valides, dédupliqué, ordre préservé. */
export function parseInterests(csv) {
  if (typeof csv !== 'string' || csv.trim() === '') return [];
  const seen = new Set();
  const out = [];
  for (const part of csv.split(',')) {
    const code = part.trim();
    if (!code || !VALID_CODES.has(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/** Tableau de codes valides → CSV (les invalides sont ignorés). */
export function serializeInterests(codes) {
  if (!Array.isArray(codes)) return '';
  const seen = new Set();
  const out = [];
  for (const code of codes) {
    const c = String(code || '').trim();
    if (!c || !VALID_CODES.has(c) || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out.join(',');
}

// ── Mots-clés de matching module ↔ intérêt ─────────────────────────────────
// Le texte analysé = filière + titre + sous-titre + tags (PAS la description
// longue : trop de bruit). Normalisation sans casse ni accents.
//
// ⚠ Mots-clés ≤ 4 lettres (« ceb », « bac », « math »…) : appariement en MOT
// ENTIER uniquement — sinon « ceb » matchait à l'intérieur de « facebook » !
const INTEREST_KEYWORDS = {
  'technologie-numerique': [
    'digital', 'numerique', 'informatique', 'internet', 'whatsapp', 'facebook',
    'tiktok', 'instagram', 'mobile money', 't-money', 'flooz', 'reseaux sociaux',
    'application', 'tech', 'web',
  ],
  'commerce-vente': [
    'commerce', 'vente', 'vendre', 'vends', 'e-commerce', 'boutique', 'client',
    'marchand',
  ],
  'gestion-comptabilite': [
    'comptabilite', 'comptable', 'gestion', 'finance', 'finances', 'budget',
    'tresorerie', 'caisse', 'fiscalite', 'ohada', 'syscohada',
  ],
  'agriculture-transformation': [
    'agriculture', 'agroalimentaire', 'transformation', 'agro', 'gari',
    'attieke', 'rural', 'recolte', 'ferme', 'elevage',
  ],
  'transport-logistique': [
    'logistique', 'transport', 'transit', 'douane', 'port', 'camion',
    'chauffeur', 'livraison',
  ],
  'communication-medias': [
    'communication', 'medias', 'communaute', 'community', 'contenu',
    'reseaux sociaux', 'publicite', 'audience', 'journalisme',
  ],
  'examens-concours': [
    'examen', 'concours', 'ceap', 'cepc', 'bepc', 'bac', 'revision', 'college',
  ],
  'mathematiques': [
    'mathematiques', 'math', 'calcul', 'algebre', 'geometrie', 'probleme',
  ],
  'langues-lecture': [
    'langues', 'lecture', 'francais', 'anglais', 'lire', 'ecriture',
    'grammaire', 'vocabulaire',
  ],
  'sciences': [
    'sciences', 'physique', 'chimie', 'biologie', 'experiences',
  ],
};

// ── Normalisation : minuscules + suppression des accents (NFD) ─────────────
function normalizeText(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Texte recherchable d'un module : filière + titre + sous-titre + tags.
function moduleHaystack(module) {
  const parts = [
    module?.filiere,
    module?.title,
    module?.subtitle,
    ...(Array.isArray(module?.tags) ? module.tags : []),
  ];
  return normalizeText(parts.filter(Boolean).join(' '));
}

/** Un module correspond-il à ce code d'intérêt ? (null-robuste) */
export function moduleMatchesInterest(module, interestCode) {
  const keywords = INTEREST_KEYWORDS[interestCode];
  if (!keywords || !module) return false;
  const haystack = moduleHaystack(module);
  if (!haystack) return false;
  for (const rawKeyword of keywords) {
    const keyword = normalizeText(rawKeyword);
    if (!keyword) continue;
    // Mots-clés courts (≤ 4 lettres) : MOT ENTIER uniquement — évite que
    // « ceb » ne matche « facebook », « bac » ne matche « bibliothèque »…
    if (keyword.length <= 4) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(haystack)) {
        return true;
      }
    } else if (haystack.includes(keyword)) {
      return true;
    }
  }
  return false;
}

/** Le module correspond-il à AU MOINS UN des codes d'intérêt ? */
function moduleMatchesAnyInterest(module, interestCodes) {
  return (interestCodes || []).some(code => moduleMatchesInterest(module, code));
}

/**
 * Sépare les modules en { recommended, others } pour le Dashboard :
 *   - recommended : modules matchant au moins un centre d'intérêt ;
 *   - others      : tous les autres ;
 *   - l'ORDRE du catalogue d'origine est préservé dans chaque liste ;
 *   - si AUCUN intérêt n'est défini (ou aucun match), recommended = [] et
 *     others = la liste complète → l'appelant retombe exactement sur le
 *     comportement d'origine (« Modules disponibles »).
 */
export function splitModulesByInterests(modules, interestsCsv) {
  const list = Array.isArray(modules) ? modules : [];
  const codes = parseInterests(interestsCsv);
  if (codes.length === 0) {
    return { recommended: [], others: list };
  }
  const recommended = [];
  const others = [];
  for (const m of list) {
    (moduleMatchesAnyInterest(m, codes) ? recommended : others).push(m);
  }
  return { recommended, others };
}
