// src/payments/paymentService.js
// Service client pour les paiements mobiles T-Money / Flooz
//
// Ce module communique avec le backend API pour initier et vérifier les paiements.
// L'app mobile ne communique JAMAIS directement avec T-Money/Flooz.

import ENV from '../config/env';

/**
 * Récupérer la tarification disponible
 */
export async function getPricing() {
  const res = await fetch(`${ENV.API_BASE}/payments/pricing`, {
    headers: { 'X-API-Key': ENV.API_KEY },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/**
 * Initier un paiement mobile
 */
export async function initiatePayment({ clientId, provider, phoneNumber, productType, productId }) {
  const res = await fetch(`${ENV.API_BASE}/payments/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': ENV.API_KEY,
    },
    body: JSON.stringify({
      learner_id: clientId,
      provider,
      phone_number: phoneNumber,
      product_type: productType,
      product_id: productId,
    }),
  });

  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/**
 * Vérifier le statut d'un paiement
 */
export async function checkPaymentStatus(reference) {
  const res = await fetch(`${ENV.API_BASE}/payments/status/${reference}`, {
    headers: { 'X-API-Key': ENV.API_KEY },
  });

  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/**
 * Récupérer l'historique des paiements
 */
export async function getPaymentHistory(clientId) {
  const res = await fetch(`${ENV.API_BASE}/payments/history/${clientId}`, {
    headers: { 'X-API-Key': ENV.API_KEY },
  });

  const json = await res.json();
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/**
 * Formate un montant en FCFA
 */
export function formatAmount(amount) {
  return `${amount.toLocaleString('fr-TG')} FCFA`;
}

/**
 * Labels pour les types de produit et fournisseurs
 */
export const PRODUCT_LABELS = {
  module_premium: 'Module premium',
  certification:  'Certification blockchain',
  bundle_all:     'Pack complet',
};

export const PROVIDER_LABELS = {
  tmoney: 'T-Money',
  flooz:  'Flooz',
};