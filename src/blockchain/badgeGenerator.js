// src/blockchain/badgeGenerator.js
// Générateur de badges EduKraft
//
// Phase MVP : génère un hash SHA-256 local simulant l'empreinte Polygon.
//             Le QR code encode une URL de vérification publique.
// Phase Production : ce module appellera le smart contract ERC-721 sur Polygon PoS
//                   et retournera le vrai hash de transaction.
//
// Structure du badge (compatible future intégration Polygon) :
// {
//   id:         UUID local (devient le tokenId ERC-721)
//   hash:       SHA-256(learnerId + moduleId + score + timestamp)
//   qrPayload:  https://verify.edukraft.tg/badge/{id}
//   issuedAt:   ISO 8601
// }

// ── Implémentation pure JS du SHA-256 (sans dépendance native) ───────────────
// Source : https://geraintluff.github.io/sha256/ (domaine public)

function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let lengthProperty = 'length';
  let i, j;
  let result = '';

  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;

  let hash = (sha256.h = sha256.h || []);
  let k = (sha256.k = sha256.k || []);
  let primeCounter = (k[lengthProperty]);

  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++]  = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';

  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
  words[words[lengthProperty]] = (asciiBitLength);

  for (j = 0; j < words[lengthProperty]; ) {
    let w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      const i2 = i + j;
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ (~e & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i]
            : (w[i - 16]
              + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
              + w[i - 7]
              + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
      hash.length = 8;
    }
    hash = hash.map((v, i) => (v + oldHash[i]) | 0);
  }

  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

// ── UUID v4 léger ────────────────────────────────────────────────────────────
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Génération du badge ───────────────────────────────────────────────────────

const VERIFY_BASE_URL = 'https://verify.edukraft.tg/badge';

/**
 * Génère un badge de certification EduKraft
 *
 * @param {Object} params
 * @param {string} params.learnerId    - UUID apprenant local
 * @param {string} params.learnerName  - Nom de l'apprenant
 * @param {string} params.moduleId     - ID du module
 * @param {string} params.moduleTitle  - Titre lisible du module
 * @param {number} params.score        - Score 0.0–1.0
 * @param {number} params.xpTotal      - Total XP gagnés dans le module
 * @returns {BadgeObject}
 */
export function generateBadge({ learnerId, learnerName, moduleId, moduleTitle, score, xpTotal }) {
  const badgeId  = uuidv4();
  const issuedAt = new Date().toISOString();

  // Seed déterministe : même apprenant + module + timestamp → hash unique
  const seed    = `${learnerId}|${moduleId}|${score}|${issuedAt}|edukraft_v1`;
  const hash    = sha256(seed);

  // Payload QR : URL de vérification publique
  // Format : https://verify.edukraft.tg/badge/{badgeId}?h={hash8chars}
  const qrPayload = `${VERIFY_BASE_URL}/${badgeId}?h=${hash.slice(0, 8)}`;

  // Métadonnées lisibles embarquées dans le QR (pour vérification offline)
  const metadata = {
    id:           badgeId,
    learner:      learnerName,
    module:       moduleTitle,
    score:        Math.round(score * 100),
    xp:           xpTotal,
    issued:       issuedAt,
    hash:         hash,
    issuer:       'EduKraft Togo',
    // Placeholder : sera remplacé par le vrai tx hash Polygon en prod
    chain:        'Polygon PoS (pending)',
    verify_url:   qrPayload,
  };

  return {
    id:         badgeId,
    hash,
    qrPayload:  JSON.stringify(metadata), // QR encode le JSON complet
    issuedAt,
    metadata,
  };
}

/**
 * Formate le hash pour affichage (ex: "5b4a...c9f2")
 */
export function formatHash(hash, chars = 8) {
  if (!hash || hash.length < chars * 2) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}

/**
 * Retourne la couleur de grade selon le score
 */
export function getBadgeTier(score) {
  if (score >= 0.9) return { label: 'Or',     color: '#F0B429', emoji: '🥇' };
  if (score >= 0.7) return { label: 'Argent', color: '#9CA3AF', emoji: '🥈' };
  return               { label: 'Bronze', color: '#CD7C3A', emoji: '🥉' };
}
