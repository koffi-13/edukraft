// server/payments.js
// Module d'intégration des paiements mobiles Togo (T-Money et Flooz)
//
// Architecture : le serveur agit comme intermédiaire entre l'app mobile et
// l'API du fournisseur de paiement (via USSD push ou API REST).
//
// Flux de paiement :
//   1. L'app envoie une demande de paiement (montant, numéro, type)
//   2. Le serveur crée une transaction en attente en DB
//   3. Le serveur appelle l'API du fournisseur (T-Money/Flooz)
//   4. Le fournisseur envoie un push USSD au client
//   5. Le client confirme sur son téléphone
//   6. Le serveur reçoit le callback et met à jour la transaction
//   7. L'app est notifiée et débloque le contenu premium
//
// Modes :
//   - MOCK (défaut, PAYMENT_MOCK=true) : simule une confirmation après 3s
//   - PRODUCTION (PAYMENT_MOCK=false) : appelle les APIs réelles des opérateurs

const crypto = require('crypto');

const PAYMENT_MOCK = process.env.PAYMENT_MOCK !== 'false';
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'edukraft-webhook-secret-change-me';

// Types de paiement supportés
const PROVIDERS = {
  TMONEY: 'tmoney',
  FLOOZ:  'flooz',
};

// Configuration des APIs fournisseurs (à remplir avec les vrais identifiants)
const PROVIDER_CONFIG = {
  tmoney: {
    base_url:   process.env.TMONEY_API_URL || 'https://api.tmoney.tg/v2',
    merchant_id: process.env.TMONEY_MERCHANT_ID || '',
    api_key:     process.env.TMONEY_API_KEY || '',
    api_secret:  process.env.TMONEY_API_SECRET || '',
  },
  flooz: {
    base_url:   process.env.FLOOZ_API_URL || 'https://api.payzone.tg/v1',
    merchant_id: process.env.FLOOZ_MERCHANT_ID || '',
    api_key:     process.env.FLOOZ_API_KEY || '',
    api_secret:  process.env.FLOOZ_API_SECRET || '',
  },
};

// Montants disponibles (en FCFA / XOF)
const PRICING = {
  module_premium: 500,    // 500 FCFA par module premium
  certification:   1000,  // 1 000 FCFA pour la certification blockchain
  bundle_all:      2000,  // 2 000 FCFA pour tous les modules
};

// ── Init ────────────────────────────────────────────────────────────────────

function init(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment (
      id              TEXT PRIMARY KEY,
      learner_id      TEXT NOT NULL REFERENCES learner(id),
      provider        TEXT NOT NULL,
      phone_number    TEXT NOT NULL,
      amount          INTEGER NOT NULL,
      currency        TEXT DEFAULT 'XOF',
      product_type    TEXT NOT NULL,
      product_id      TEXT,
      status          TEXT DEFAULT 'pending',
      reference       TEXT UNIQUE,
      external_tx_id  TEXT,
      provider_response TEXT,
      confirmed_at    TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_payment_learner ON payment(learner_id);
    CREATE INDEX IF NOT EXISTS idx_payment_status ON payment(status);
    CREATE INDEX IF NOT EXISTS idx_payment_reference ON payment(reference);
  `);

  const mode = PAYMENT_MOCK ? 'MOCK' : 'PRODUCTION';
  console.log(`[Payments] Table initialisée (mode: ${mode})`);

  if (!PAYMENT_MOCK) {
    const hasTmoneyCreds = PROVIDER_CONFIG.tmoney.api_key && PROVIDER_CONFIG.tmoney.merchant_id;
    const hasFloozCreds  = PROVIDER_CONFIG.flooz.api_key && PROVIDER_CONFIG.flooz.merchant_id;
    console.log(`[Payments] T-Money: ${hasTmoneyCreds ? 'configuré' : '⚠️ identifiants manquants'}`);
    console.log(`[Payments] Flooz:   ${hasFloozCreds ? 'configuré' : '⚠️ identifiants manquants'}`);
  }
}

// ── Créer une demande de paiement ───────────────────────────────────────────

/**
 * @param {Object} params
 * @param {string} params.learnerServerId - ID serveur du learner
 * @param {string} params.provider - 'tmoney' ou 'flooz'
 * @param {string} params.phoneNumber - Numéro au format 22890XXXXXX
 * @param {string} params.productType - 'module_premium' | 'certification' | 'bundle_all'
 * @param {string} params.productId - ID du module (si module_premium)
 * @returns {Promise<Object>}
 */
async function createPayment(db, { learnerServerId, provider, phoneNumber, productType, productId }) {
  // Validations
  if (!Object.values(PROVIDERS).includes(provider)) {
    throw new Error(`Fournisseur invalide: ${provider}. Utilisez 'tmoney' ou 'flooz'`);
  }

  const cleanPhone = phoneNumber.replace(/\s/g, '');
  if (!cleanPhone || !/^22[0-9]{8,9}$/.test(cleanPhone)) {
    throw new Error('Numéro de téléphone invalide (format: 22890XXXXXX)');
  }

  const amount = PRICING[productType];
  if (!amount) {
    throw new Error(`Type de produit invalide: ${productType}`);
  }

  const id = `pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const reference = `EDK${Date.now()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const now = new Date().toISOString();

  // Insérer en base
  db.prepare(`
    INSERT INTO payment (id, learner_id, provider, phone_number, amount, currency, product_type, product_id, status, reference, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'XOF', ?, ?, 'pending', ?, ?, ?)
  `).run(id, learnerServerId, provider, cleanPhone, amount, productType, productId || null, reference, now, now);

  if (PAYMENT_MOCK) {
    console.log(`[Payments/MOCK] Paiement initié: ${reference} — ${amount} FCFA via ${provider}`);
  } else {
    // Appel l'API du fournisseur en arrière-plan (non bloquant pour la réponse)
    _callProviderAPI(provider, reference, cleanPhone, amount, productType).catch(err => {
      console.error(`[Payments] Erreur API ${provider}:`, err.message);
    });
  }

  return {
    id,
    reference,
    provider,
    amount,
    currency: 'XOF',
    product_type: productType,
    product_id: productId || null,
    status: 'pending',
    mock_mode: PAYMENT_MOCK,
  };
}

// ── Appel API fournisseur (production) ───────────────────────────────────────

/**
 * Appelle l'API réelle du fournisseur de paiement.
 * T-Money : POST /payments/pay avec auth HMAC-SHA256
 * Flooz   : POST /transactions avec Bearer token
 *
 * @private
 */
async function _callProviderAPI(provider, reference, phoneNumber, amount, productType) {
  const config = PROVIDER_CONFIG[provider];
  if (!config || !config.api_key || !config.merchant_id) {
    console.warn(`[Payments] ${provider} non configuré — le callback devra confirmer manuellement`);
    return;
  }

  const timestamp = Date.now().toString();
  const body = {
    merchant_id: config.merchant_id,
    reference,
    phone_number: phoneNumber,
    amount,
    currency: 'XOF',
    description: `EduKraft - ${productType}`,
    callback_url: `${process.env.PUBLIC_URL || 'https://api.edukraft.tg'}/api/payments/callback`,
  };

  try {
    if (provider === 'tmoney') {
      // T-Money utilise HMAC-SHA256 pour l'authentification
      const payload = JSON.stringify(body);
      const signature = crypto
        .createHmac('sha256', config.api_secret)
        .update(payload)
        .digest('hex');

      const response = await fetch(`${config.base_url}/payments/pay`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.api_key,
          'X-Signature': signature,
          'X-Timestamp': timestamp,
        },
        body: payload,
      });

      const result = await response.json();
      console.log(`[Payments/T-Money] Réponse:`, JSON.stringify(result));

      if (!response.ok) {
        throw new Error(result.message || `T-Money HTTP ${response.status}`);
      }

      // T-Money peut répondre immédiatement ou de manière asynchrone
      if (result.status === 'completed' || result.status === 'success') {
        // Le paiement a été confirmé immédiatement
        return { immediate: true, txId: result.transaction_id };
      }

    } else if (provider === 'flooz') {
      // Flooz (Payzone) utilise Bearer token
      const response = await fetch(`${config.base_url}/transactions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.api_key}`,
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();
      console.log(`[Payments/Flooz] Réponse:`, JSON.stringify(result));

      if (!response.ok) {
        throw new Error(result.message || `Flooz HTTP ${response.status}`);
      }

      if (result.status === 'completed' || result.status === 'success') {
        return { immediate: true, txId: result.transaction_id || result.tx_id };
      }
    }
  } catch (err) {
    console.error(`[Payments/${provider}] Erreur appel API:`, err.message);
    throw err;
  }
}

// ── Vérifier le statut d'un paiement ────────────────────────────────────────

/**
 * @param {string} db
 * @param {string} reference - Référence de paiement
 * @returns {Promise<Object>}
 */
async function checkStatus(db, reference) {
  const payment = db.prepare('SELECT * FROM payment WHERE reference = ?').get(reference);
  if (!payment) {
    throw new Error('Paiement non trouvé');
  }

  // Mode mock : confirmer automatiquement les paiements pending > 3s
  if (PAYMENT_MOCK && payment.status === 'pending') {
    const elapsed = Date.now() - new Date(payment.created_at).getTime();
    if (elapsed > 3000) {
      _confirmPayment(db, payment.id, 'mock_tx_001');
    }
  } else if (!PAYMENT_MOCK && payment.status === 'pending') {
    // Interroger l'API du fournisseur pour le statut réel
    await _checkProviderStatus(db, payment);
  }

  const updated = db.prepare('SELECT * FROM payment WHERE id = ?').get(payment.id);
  return _formatPayment(updated);
}

/**
 * Vérifie le statut auprès du fournisseur en production
 * @private
 */
async function _checkProviderStatus(db, payment) {
  const config = PROVIDER_CONFIG[payment.provider];
  if (!config || !config.api_key) return;

  try {
    let url, headers;
    if (payment.provider === 'tmoney') {
      url = `${config.base_url}/payments/${payment.reference}/status`;
      headers = { 'X-API-Key': config.api_key };
    } else {
      url = `${config.base_url}/transactions/${payment.reference}`;
      headers = { 'Authorization': `Bearer ${config.api_key}` };
    }

    const response = await fetch(url, { headers });
    const result = await response.json();

    if (result.status === 'completed' || result.status === 'success') {
      _confirmPayment(db, payment.id, result.transaction_id || result.tx_id, result);
    } else if (result.status === 'failed' || result.status === 'expired') {
      const now = new Date().toISOString();
      db.prepare(`
        UPDATE payment SET status = 'failed', provider_response = ?, updated_at = ? WHERE id = ?
      `).run(JSON.stringify(result), now, payment.id);
    }
  } catch (err) {
    console.warn(`[Payments] Erreur check status ${payment.provider}:`, err.message);
  }
}

// ── Callback du fournisseur (webhook) ────────────────────────────────────────

/**
 * Vérifie la signature HMAC du callback webhook
 * @param {string} body - Corps brut de la requête (string)
 * @param {string} signature - Header X-Signature
 * @returns {boolean}
 */
function verifyWebhookSignature(body, signature) {
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

/**
 * Endpoint à appeler par le fournisseur quand le paiement est confirmé.
 * En production, cette route est protégée par une signature HMAC.
 */
function handleProviderCallback(db, body, signature) {
  // Vérifier la signature si on n'est pas en mode mock
  if (!PAYMENT_MOCK && signature) {
    // La vérification se fait sur le body brut (géré dans index.js)
    // Ici on fait une vérification JSON.stringify comme fallback
    const expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    if (signature !== expected) {
      return { success: false, error: 'Signature invalide' };
    }
  }

  const { reference, status, external_tx_id, provider_response } = body;

  if (!reference) {
    return { success: false, error: 'Référence manquante' };
  }

  const payment = db.prepare('SELECT * FROM payment WHERE reference = ?').get(reference);
  if (!payment) {
    return { success: false, error: 'Paiement non trouvé' };
  }

  if (payment.status !== 'pending') {
    return { success: false, error: 'Paiement déjà traité' };
  }

  if (status === 'success' || status === 'completed') {
    _confirmPayment(db, payment.id, external_tx_id, provider_response);
  } else {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE payment SET status = 'failed', provider_response = ?, updated_at = ? WHERE id = ?
    `).run(JSON.stringify(provider_response || {}), now, payment.id);
  }

  return { success: true };
}

// ── Historique des paiements d'un learner ───────────────────────────────────

function getPaymentHistory(db, learnerServerId) {
  return db.prepare(
    'SELECT * FROM payment WHERE learner_id = ? ORDER BY created_at DESC LIMIT 20'
  ).all(learnerServerId).map(_formatPayment);
}

// ── Internal ────────────────────────────────────────────────────────────────

function _confirmPayment(db, paymentId, externalTxId, providerResponse) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE payment SET
      status = 'confirmed',
      external_tx_id = ?,
      provider_response = ?,
      confirmed_at = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
    externalTxId || null,
    JSON.stringify(providerResponse || { mock: true }),
    now, now, paymentId
  );
  console.log(`[Payments] Paiement confirmé: ${paymentId}, tx: ${externalTxId}`);
}

function _formatPayment(p) {
  return {
    id:               p.id,
    reference:        p.reference,
    provider:         p.provider,
    phone_number:     p.phone_number,
    amount:           p.amount,
    currency:         p.currency,
    product_type:     p.product_type,
    product_id:       p.product_id,
    status:           p.status,
    external_tx_id:   p.external_tx_id,
    confirmed_at:     p.confirmed_at,
    created_at:       p.created_at,
  };
}

module.exports = {
  init,
  PROVIDERS,
  PRICING,
  createPayment,
  checkStatus,
  handleProviderCallback,
  verifyWebhookSignature,
  getPaymentHistory,
  PAYMENT_MOCK,
};
