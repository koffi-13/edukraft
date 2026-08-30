// src/screens/EmailVerificationScreen.js
// Écran de vérification d'email (v1.1.9).
//
// Affiché après connexion (et après inscription) quand le compte porte un
// email NON vérifié — les comptes Google/Apple/Facebook arrivent déjà
// vérifiés (le provider a validé l'adresse), l'écran ne concerne donc que
// les comptes email+mot-de-passe.
//
// Flux :
//   1. Ouverture → envoi AUTOMATIQUE d'un code à 6 chiffres à l'email
//      (POST /api/auth/verify-email/request ; TTL 10 min, max 5 essais).
//      Mode test (aucun provider email configuré côté serveur) : le code
//      est affiché à l'écran pour ne pas bloquer l'utilisateur.
//   2. Saisie du code (6 cases) → POST /api/auth/verify-email/confirm.
//   3. Succès → user.email_verified = true → Dashboard.
//   4. « Plus tard » → report (session courante) + rappel permanent dans
//      le Profil (carte « Email non vérifié »).
//
// Jamais bloquant : l'app reste pleinement utilisable sans vérification.

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Platform, Alert, ActivityIndicator, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { t } from '../i18n';
import { useAuth } from '../contexts/AuthContext';

export default function EmailVerificationScreen() {
  const insets = useSafeAreaInsets();
  const {
    user, needsEmailVerification, verificationSkipped,
    resendVerificationCode, verifyEmail, skipEmailVerification,
  } = useAuth();

  const [code, setCode]           = useState('');
  const [loading, setLoading]     = useState(false);
  const [sending, setSending]     = useState(false);
  const [error, setError]         = useState(null);
  const [cooldown, setCooldown]   = useState(0);
  const [sentOnce, setSentOnce]   = useState(false);
  const inputRef = useRef(null);

  const email = user?.email || '';

  // ── Compte à rebours du bouton « Renvoyer » ─────────────────────────────
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // ── Envoi automatique du code à l'ouverture ─────────────────────────────
  const requestCode = useCallback(async (silent = false) => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const data = await resendVerificationCode();
      setSentOnce(true);
      setCooldown(60);
      if (data?.devCode) {
        // Mode test (serveur sans provider email) : afficher le code
        Alert.alert(
          t('verify.test_mode_title'),
          t('verify.test_mode_msg', { code: data.devCode }),
        );
      } else if (!silent) {
        Alert.alert(t('verify.code_sent_title'), t('verify.code_sent_msg', { email }));
      }
    } catch (e) {
      const msg = e.message || '';
      if (/déjà vérifié|already/i.test(msg)) {
        // Déjà vérifié entre-temps (autre appareil) — l'état se réactualisera
      } else if (!silent) {
        setError(msg);
      } else {
        setError(msg);
      }
    } finally {
      setSending(false);
    }
  }, [sending, resendVerificationCode, email]);

  useEffect(() => {
    if (needsEmailVerification && !sentOnce) {
      requestCode(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsEmailVerification]);

  // Déjà vérifié pendant qu'on regrait cet écran (ex : autre appareil)
  useEffect(() => {
    if (!needsEmailVerification) Keyboard.dismiss();
  }, [needsEmailVerification]);

  // ── Confirmation du code ────────────────────────────────────────────────
  const handleVerify = async () => {
    if (code.length !== 6) {
      setError(t('verify.error_code_length'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await verifyEmail(code);
      setCode('');
      Alert.alert(
        t('verify.success_title'),
        t('verify.success_msg'),
        [{ text: 'OK' }],
      );
    } catch (e) {
      setError(e.message || t('verify.error_generic'));
      setCode('');
      try { inputRef.current?.focus(); } catch (_) {}
    } finally {
      setLoading(false);
    }
  };

  const handleChangeCode = (text) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 6);
    setCode(cleaned);
    if (error) setError(null);
  };

  if (!needsEmailVerification) {
    // Vérifié entre-temps → le gating raccommode directement le Dashboard
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.centerCard}>
          <View style={styles.iconCircle}>
            <Text style={styles.iconText}>✓</Text>
          </View>
          <Text style={styles.title}>{t('verify.already_title')}</Text>
          <Text style={styles.subtitle}>{t('verify.already_msg')}</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.centerCard}>
        {/* Icône bouclier */}
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>🛡️</Text>
        </View>

        <Text style={styles.title}>{t('verify.title')}</Text>
        <Text style={styles.subtitle}>
          {t('verify.subtitle')}{' '}
          <Text style={styles.emailText}>{email}</Text>
        </Text>

        {/* Code reçu ? */}
        {sending && !sentOnce ? (
          <View style={styles.sendingWrap}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.sendingText}>{t('verify.sending')}</Text>
          </View>
        ) : (
          <Text style={styles.hint}>{sentOnce ? t('verify.enter_code') : t('verify.sending_pending')}</Text>
        )}

        {/* Saisie du code — un seul champ lisible (6 chiffres) */}
        <TextInput
          ref={inputRef}
          style={styles.codeInput}
          value={code}
          onChangeText={handleChangeCode}
          placeholder="––––––"
          placeholderTextColor={Colors.ink30}
          keyboardType="number-pad"
          maxLength={6}
          autoCorrect={false}
          autoCapitalize="none"
          textAlign="center"
          autoFocus={Platform.OS !== 'web'}
          accessibilityLabel={t('verify.enter_code')}
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* Bouton Vérifier */}
        <TouchableOpacity
          style={[styles.verifyButton, (loading || code.length !== 6) && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={loading || code.length !== 6}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator size="small" color={Colors.surface} />
          ) : (
            <Text style={styles.verifyButtonText}>{t('verify.confirm_button')}</Text>
          )}
        </TouchableOpacity>

        {/* Renvoyer */}
        <TouchableOpacity
          style={styles.resendButton}
          onPress={() => requestCode(false)}
          disabled={cooldown > 0 || sending}
          activeOpacity={0.7}
        >
          <Text style={[styles.resendText, (cooldown > 0 || sending) && styles.resendDisabled]}>
            {cooldown > 0
              ? t('verify.resend_in', { seconds: cooldown })
              : t('verify.resend_button')}
          </Text>
        </TouchableOpacity>

        {/* Plus tard */}
        <TouchableOpacity
          style={styles.laterButton}
          onPress={() => skipEmailVerification()}
          disabled={verificationSkipped}
          activeOpacity={0.7}
        >
          <Text style={styles.laterText}>{t('verify.later_button')}</Text>
        </TouchableOpacity>

        <Text style={styles.smallNote}>{t('verify.note')}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    paddingBottom: Spacing.xl + 24,
  },
  centerCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.xl,
    alignItems: 'center',
    ...Shadow.card,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  iconCircle: {
    width: 72, height: 72,
    borderRadius: 36,
    backgroundColor: Colors.primary + '18',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  iconText: { fontSize: 32 },
  title: {
    fontSize: Typography.h2,
    fontWeight: Typography.bold,
    color: Colors.ink,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  subtitle: {
    fontSize: Typography.body,
    color: Colors.ink60,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: Spacing.lg,
  },
  emailText: {
    color: Colors.primary,
    fontWeight: Typography.semibold,
  },
  hint: {
    fontSize: Typography.small,
    color: Colors.ink50,
    textAlign: 'center',
    marginBottom: Spacing.md,
  },
  sendingWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: Spacing.md,
  },
  sendingText: {
    fontSize: Typography.small,
    color: Colors.ink50,
  },
  codeInput: {
    width: '100%',
    backgroundColor: Colors.background,
    borderWidth: 2,
    borderColor: Colors.primary + '40',
    borderRadius: Radius.lg,
    fontSize: 34,
    fontWeight: Typography.bold,
    letterSpacing: 12,
    color: Colors.ink,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: Spacing.md,
  },
  errorText: {
    color: Colors.error || '#D93025',
    fontSize: Typography.small,
    textAlign: 'center',
    marginBottom: Spacing.sm,
  },
  verifyButton: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: 15,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    width: '100%',
    marginBottom: Spacing.sm,
  },
  buttonDisabled: { opacity: 0.5 },
  verifyButtonText: {
    color: Colors.surface,
    fontSize: Typography.body,
    fontWeight: Typography.bold,
  },
  resendButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.xs,
  },
  resendText: {
    color: Colors.primary,
    fontSize: Typography.small,
    fontWeight: Typography.semibold,
  },
  resendDisabled: { color: Colors.ink30 },
  laterButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  laterText: {
    color: Colors.ink50,
    fontSize: Typography.small,
  },
  smallNote: {
    marginTop: Spacing.md,
    fontSize: 11,
    color: Colors.ink30,
    textAlign: 'center',
    lineHeight: 15,
  },
});
