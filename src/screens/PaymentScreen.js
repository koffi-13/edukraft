// src/screens/PaymentScreen.js
// Écran de paiement mobile T-Money / Flooz
//
// L'utilisateur choisit un produit (module premium, certification, pack complet),
// sélectionne son opérateur, entre son numéro et lance le paiement.
// Le flow est géré côté serveur — l'app ne contacte jamais directement les opérateurs.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { useDb } from '../database/DbProvider';
import { t } from '../i18n';
import {
  getPricing,
  initiatePayment,
  checkPaymentStatus,
  getPaymentHistory,
  formatAmount,
  PRODUCT_LABELS,
  PROVIDER_LABELS,
} from '../payments/paymentService';

// ── Produits disponibles ────────────────────────────────────────────────────
const PRODUCTS = [
  { key: 'module_premium', icon: '📘', color: Colors.primary },
  { key: 'certification',  icon: '🔗', color: Colors.teal },
  { key: 'bundle_all',     icon: '📦', color: Colors.xpGold },
];

// ── Composant principal ─────────────────────────────────────────────────────
export default function PaymentScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { learner } = useDb();

  // Produit sélectionné (peut être pré-rempli via route params)
  const preselected = route?.params?.productType || null;
  const [selectedProduct, setSelectedProduct] = useState(preselected);
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pricing, setPricing] = useState(null);

  // États du paiement
  const [loading, setLoading] = useState(false);
  const [currentPayment, setCurrentPayment] = useState(null); // { reference, ... }
  const [polling, setPolling] = useState(false);
  const [paymentResult, setPaymentResult] = useState(null); // 'confirmed' | 'failed'

  // Historique
  const [history, setHistory] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  // Charger la tarification au montage
  useEffect(() => {
    loadPricing();
    loadHistory();
  }, []);

  const loadPricing = async () => {
    try {
      const data = await getPricing();
      setPricing(data.products);
    } catch (err) {
      console.warn('[PaymentScreen] Erreur chargement tarifs:', err.message);
      // Fallback local
      setPricing({ module_premium: 500, certification: 1000, bundle_all: 2000 });
    }
  };

  const loadHistory = async () => {
    if (!learner?.id) return;
    try {
      const data = await getPaymentHistory(learner.id);
      setHistory(data || []);
    } catch (err) {
      console.warn('[PaymentScreen] Erreur chargement historique:', err.message);
    }
  };

  // Polling du statut de paiement
  const pollPaymentStatus = useCallback(async (reference) => {
    setPolling(true);
    const maxAttempts = 20; // 20 × 3s = 60s max
    let attempt = 0;

    const poll = async () => {
      attempt++;
      try {
        const result = await checkPaymentStatus(reference);
        if (result.status === 'confirmed') {
          setPaymentResult('confirmed');
          setPolling(false);
          setCurrentPayment(null);
          loadHistory();
          return;
        }
        if (result.status === 'failed') {
          setPaymentResult('failed');
          setPolling(false);
          setCurrentPayment(null);
          return;
        }
        // Encore pending > re-poll
        if (attempt < maxAttempts) {
          setTimeout(poll, 3000);
        } else {
          setPaymentResult('timeout');
          setPolling(false);
          setCurrentPayment(null);
        }
      } catch (err) {
        if (attempt < maxAttempts) {
          setTimeout(poll, 3000);
        } else {
          setPaymentResult('failed');
          setPolling(false);
          setCurrentPayment(null);
        }
      }
    };

    poll();
  }, []);

  // Lancer un paiement
  const handlePay = async () => {
    // Validations
    if (!selectedProduct) {
      Alert.alert(t('payment.error_no_provider'), t('payment.select_product'));
      return;
    }
    if (!selectedProvider) {
      Alert.alert(t('payment.error_no_provider'), t('payment.choose_provider'));
      return;
    }
    const cleanPhone = phoneNumber.replace(/\s/g, '');
    if (!/^22[0-9]{8}$/.test(cleanPhone)) {
      Alert.alert(t('payment.error_invalid_phone'), t('payment.phone_placeholder'));
      return;
    }

    setLoading(true);
    setPaymentResult(null);

    try {
      const result = await initiatePayment({
        clientId: learner.id,
        provider: selectedProvider,
        phoneNumber: cleanPhone,
        productType: selectedProduct,
        productId: route?.params?.moduleId || null,
      });

      setCurrentPayment(result);
      setLoading(false);

      // Lancer le polling si le paiement n'est pas immédiatement confirmé
      if (result.status === 'pending') {
        if (result.mock_mode) {
          // En mode mock, attendre 4s puis vérifier
          setTimeout(() => pollPaymentStatus(result.reference), 4000);
        } else {
          // Production : vérifier immédiatement
          pollPaymentStatus(result.reference);
        }
      }
    } catch (err) {
      setLoading(false);
      const msg = err.message || '';
      if (msg.includes('network') || msg.includes('fetch')) {
        Alert.alert(t('payment.error_network'), msg);
      } else {
        Alert.alert(t('payment.error_server'), msg);
      }
    }
  };

  // Rafraîchir l'historique
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadPricing(), loadHistory()]);
    setRefreshing(false);
  };

  const amount = pricing?.[selectedProduct] || 0;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('payment.title')}</Text>
        <Text style={styles.headerSub}>{t('payment.select_product')}</Text>
      </View>

      {/* Sélection du produit */}
      <View style={styles.section}>
        {PRODUCTS.map((product) => (
          <TouchableOpacity
            key={product.key}
            style={[
              styles.productCard,
              Shadow.card,
              selectedProduct === product.key && { borderColor: product.color, borderWidth: 2 },
            ]}
            onPress={() => {
              setSelectedProduct(product.key);
              setPaymentResult(null);
            }}
          >
            <View style={styles.productLeft}>
              <Text style={styles.productIcon}>{product.icon}</Text>
              <View>
                <Text style={styles.productTitle}>{t(`payment.${product.key}`)}</Text>
                <Text style={styles.productAmount}>
                  {pricing ? formatAmount(pricing[product.key]) : '...'}
                </Text>
              </View>
            </View>
            {selectedProduct === product.key && (
              <View style={[styles.checkMark, { backgroundColor: product.color }]}>
                <Text style={styles.checkMarkText}>✓</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Formulaire de paiement */}
      {selectedProduct && !currentPayment && !paymentResult && (
        <View style={styles.section}>
          <Text style={styles.formTitle}>{t('payment.choose_provider')}</Text>

          {/* Boutons opérateur */}
          <View style={styles.providerRow}>
            {['tmoney', 'flooz'].map((prov) => (
              <TouchableOpacity
                key={prov}
                style={[
                  styles.providerBtn,
                  selectedProvider === prov && styles.providerBtnActive,
                ]}
                onPress={() => setSelectedProvider(prov)}
              >
                <Text style={[
                  styles.providerBtnText,
                  selectedProvider === prov && styles.providerBtnTextActive,
                ]}>
                  {t(`payment.${prov}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Champ téléphone */}
          <TextInput
            style={styles.phoneInput}
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder={t('payment.phone_placeholder')}
            placeholderTextColor={Colors.ink30}
            keyboardType="phone-pad"
            maxLength={14}
            autoComplete="tel"
          />

          {/* Récapitulatif + bouton payer */}
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('payment.amount')}</Text>
              <Text style={styles.summaryAmount}>{formatAmount(amount)}</Text>
            </View>
            <Text style={styles.summaryProvider}>
              {selectedProvider ? `${t('payment.pay_with')} ${t(`payment.${selectedProvider}`)}` : ''}
            </Text>

            <TouchableOpacity
              style={[styles.payButton, Shadow.button, (!selectedProvider || !phoneNumber) && styles.payButtonDisabled]}
              onPress={handlePay}
              disabled={loading || !selectedProvider || !phoneNumber}
            >
              {loading ? (
                <ActivityIndicator color={Colors.surface} />
              ) : (
                <Text style={styles.payButtonText}>
                  {t('payment.pay')} — {formatAmount(amount)}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.ussdHint}>{t('payment.ussd_hint')}</Text>
        </View>
      )}

      {/* Paiement en cours (polling) */}
      {polling && currentPayment && (
        <View style={styles.section}>
          <View style={styles.pendingCard}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.pendingText}>{t('payment.pending')}</Text>
            <Text style={styles.pendingRef}>
              {t('payment.tx_reference')} : {currentPayment.reference}
            </Text>
            <TouchableOpacity
              style={styles.checkBtn}
              onPress={() => checkPaymentStatus(currentPayment.reference).then(() => {})}
            >
              <Text style={styles.checkBtnText}>{t('payment.check_status')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Résultat du paiement */}
      {paymentResult && (
        <View style={styles.section}>
          <View style={[
            styles.resultCard,
            paymentResult === 'confirmed' && styles.resultCardSuccess,
            paymentResult !== 'confirmed' && styles.resultCardFailed,
          ]}>
            <Text style={styles.resultEmoji}>
              {paymentResult === 'confirmed' ? '✅' : '❌'}
            </Text>
            <Text style={styles.resultText}>
              {paymentResult === 'confirmed'
                ? t('payment.confirmed')
                : t('payment.failed')
              }
            </Text>
            <TouchableOpacity
              style={styles.resultDismiss}
              onPress={() => setPaymentResult(null)}
            >
              <Text style={styles.resultDismissText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Historique des paiements */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('payment.history')}</Text>
        {history.length === 0 ? (
          <Text style={styles.emptyHistory}>{t('payment.no_history')}</Text>
        ) : (
          history.map((tx) => (
            <View key={tx.id} style={[styles.historyItem, Shadow.card]}>
              <View style={styles.historyLeft}>
                <Text style={styles.historyProduct}>
                  {PRODUCT_LABELS[tx.product_type] || tx.product_type}
                </Text>
                <Text style={styles.historyDate}>
                  {new Date(tx.created_at).toLocaleDateString('fr-TG', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </Text>
              </View>
              <View style={styles.historyRight}>
                <Text style={styles.historyAmount}>{formatAmount(tx.amount)}</Text>
                <View style={[
                  styles.statusChip,
                  tx.status === 'confirmed' && styles.statusChipSuccess,
                  tx.status === 'failed' && styles.statusChipFailed,
                ]}>
                  <Text style={[
                    styles.statusText,
                    tx.status === 'confirmed' && styles.statusTextSuccess,
                    tx.status === 'failed' && styles.statusTextFailed,
                  ]}>
                    {t(`payment.status_${tx.status}`)}
                  </Text>
                </View>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    padding: Spacing.xl,
    paddingBottom: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: Typography.h1,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  headerSub: {
    fontSize: Typography.body,
    color: Colors.ink50,
    marginTop: Spacing.xs,
  },
  section: {
    padding: Spacing.lg,
  },
  sectionTitle: {
    fontSize: Typography.h3,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    marginBottom: Spacing.md,
  },
  formTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
    marginBottom: Spacing.sm,
  },

  // Produits
  productCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderColor: Colors.border,
    borderWidth: 1,
  },
  productLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  productIcon: {
    fontSize: 28,
  },
  productTitle: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
  },
  productAmount: {
    fontSize: Typography.caption,
    color: Colors.ink50,
    marginTop: 2,
  },
  checkMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkMarkText: {
    color: Colors.surface,
    fontSize: 14,
    fontWeight: Typography.bold,
  },

  // Opérateurs
  providerRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  providerBtn: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  providerBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  providerBtnText: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink60,
  },
  providerBtnTextActive: {
    color: Colors.primary,
  },

  // Téléphone
  phoneInput: {
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontSize: Typography.bodyLg,
    color: Colors.ink,
    marginBottom: Spacing.lg,
  },

  // Récapitulatif + Payer
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  summaryLabel: {
    fontSize: Typography.body,
    color: Colors.ink60,
  },
  summaryAmount: {
    fontSize: Typography.h2,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  summaryProvider: {
    fontSize: Typography.caption,
    color: Colors.ink50,
    marginBottom: Spacing.md,
  },
  payButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  payButtonDisabled: {
    backgroundColor: Colors.ink30,
  },
  payButtonText: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.surface,
  },
  ussdHint: {
    fontSize: Typography.caption,
    color: Colors.ink50,
    textAlign: 'center',
    marginTop: Spacing.md,
    lineHeight: 18,
  },

  // Paiement en cours
  pendingCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.primaryLight,
  },
  pendingText: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.primary,
    marginTop: Spacing.md,
  },
  pendingRef: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
    marginTop: Spacing.sm,
  },
  checkBtn: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  checkBtnText: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.primary,
  },

  // Résultat
  resultCard: {
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    alignItems: 'center',
    borderWidth: 1,
  },
  resultCardSuccess: {
    backgroundColor: Colors.tealLight,
    borderColor: Colors.teal,
  },
  resultCardFailed: {
    backgroundColor: Colors.coralLight,
    borderColor: Colors.coral,
  },
  resultEmoji: {
    fontSize: 40,
    marginBottom: Spacing.md,
  },
  resultText: {
    fontSize: Typography.h3,
    fontWeight: Typography.bold,
    color: Colors.ink,
    marginBottom: Spacing.md,
  },
  resultDismiss: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.ink10,
  },
  resultDismissText: {
    fontSize: Typography.caption,
    fontWeight: Typography.semibold,
    color: Colors.ink60,
  },

  // Historique
  emptyHistory: {
    fontSize: Typography.body,
    color: Colors.ink50,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  historyItem: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyLeft: {
    flex: 1,
  },
  historyProduct: {
    fontSize: Typography.body,
    fontWeight: Typography.semibold,
    color: Colors.ink,
  },
  historyDate: {
    fontSize: Typography.tiny,
    color: Colors.ink30,
    marginTop: 2,
  },
  historyRight: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  historyAmount: {
    fontSize: Typography.body,
    fontWeight: Typography.bold,
    color: Colors.ink,
  },
  statusChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
  },
  statusChipSuccess: {
    backgroundColor: Colors.tealLight,
  },
  statusChipFailed: {
    backgroundColor: Colors.coralLight,
  },
  statusText: {
    fontSize: Typography.tiny,
    fontWeight: Typography.semibold,
    color: Colors.ink60,
  },
  statusTextSuccess: {
    color: Colors.teal,
  },
  statusTextFailed: {
    color: Colors.coral,
  },
});