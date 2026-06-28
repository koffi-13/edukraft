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
// En mode développement (PAYMENT_MOCK=true) : simule une confirmation immédiate

const crypto = require('crypto');

const PAYMENT_MOCK = process.env.PAYMENT_MOCK !== 'false';

// Types de paiement supportés
const PROVIDERS = {
  TMONEY: 'tmoney',
  FLOOZ:  'flooz',
};

// Montants disponibles (en FCFA)
const PRICING = {
  module_premium: 500,   // 500 FCFA par module premium
  certification:   1000, // 1 000 FCFA pour la certification blockchain
  bundle_all:      2000, // 2 000 FCFA pour tous les modules
};

// ── Init ────────────────────────────────────────────────────────────────────

function init(db) {
  // Créer la table des paiements si elle n'existe pas
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

  console.log(`[Payments] Table initialisée (mode: ${PAYMENT_MOCK ? 'MOCK' : 'PRODUCTION'})`);
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

  if (!phoneNumber || !/^22[0-9]{8}$/.test(phoneNumber.replace(/\s/g, ''))) {
    throw new Error('Numéro de téléphone invalide (format: 22890XXXXXX)');
  }

  const amount = PRICING[productType];
  if (!amount) {
    throw new Error(`Type de produit invalide: ${productType}`);
  }

  const id = `pay_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const reference = `EDK${Date.now()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const now = new Date().toISOString();
  const cleanPhone = phoneNumber.replace(/\s/g, '');

  // Insérer en base
  db.prepare(`
    INSERT INTO payment (id, learner_id, provider, phone_number, amount, currency, product_type, product_id, status, reference, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'XOF', ?, ?, 'pending', ?, ?, ?)
  `).run(id, learnerServerId, provider, cleanPhone, amount, productType, productId, reference, now, now);

  // En mode mock : simuler un paiement réussi après 2 secondes
  if (PAYMENT_MOCK) {
    console.log(`[Payments/MOCK] Paiement initié: ${reference} — ${amount} FCFA via ${provider}`);
  } else {
    // TODO: Appeler l'API réelle du fournisseur
    // Exemple T-Money: POST https://api.tmoney.tg/v1/payments
    console.log(`[Payments] Initiation paiement réel: ${reference}`);
  }

  return {
    id,
    reference,
    provider,
    amount,
    currency: 'XOF',
    product_type: productType,
    status: 'pending',
    // En mode mock, l'app peut interroger le statut après un court délai
    mock_mode: PAYMENT_MOCK,
  };
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

  // En mode mock : confirmer automatiquement les paiements pending > 3s
  if (PAYMENT_MOCK && payment.status === 'pending') {
    const elapsed = Date.now() - new Date(payment.created_at).getTime();
    if (elapsed > 3000) {
      _confirmPayment(db, payment.id, 'mock_tx_001');
    }
  } else if (!PAYMENT_MOCK && payment.status === 'pending') {
    // TODO: Interroger l'API du fournisseur pour le statut réel
    // const status = await _checkProviderStatus(payment);
  }

  const updated = db.prepare('SELECT * FROM payment WHERE id = ?').get(payment.id);
  return _formatPayment(updated);
}

// ── Callback du fournisseur (webhook) ────────────────────────────────────────

/**
 * Endpoint à appeler par le fournisseur quand le paiement est confirmé
 * En production, cette route est protégée par une signature HMAC
 */
function handleProviderCallback(db, body, signature) {
  const { reference, status, external_tx_id, provider_response } = body;

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
    // Marquer comme échoué
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
    externalTxId,
    JSON.stringify(providerResponse || { mock: true }),
    now, now, paymentId
  );
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
  getPaymentHistory,
  PAYMENT_MOCK,
};