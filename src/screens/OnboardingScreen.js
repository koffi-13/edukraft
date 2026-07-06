// src/screens/OnboardingScreen.js
// Ecran de finalisation du profil — apparaît une seule fois.
// Au reredemarrage, le learner existe deja > Dashboard direct.

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { useDb }  from '../database/DbProvider';
import { useAuth } from '../contexts/AuthContext';
import { t, setLanguage, AVAILABLE_LANGUAGES } from '../i18n';

export default function OnboardingScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { createLearner, setDailyGoal } = useDb();
  const { user, logout } = useAuth();

  const [name, setName]   = useState('');
  const [phone, setPhone] = useState(user?.phone || '');
  const [lang, setLang]   = useState(user?.language || 'fr');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      const dn = user.display_name || user.first_name || user.name || '';
      if (dn) setName(dn);
      if (user.language) { setLang(user.language); setLanguage(user.language); }
      if (user.phone) setPhone(user.phone);
    }
  }, [user]);

  const handleStart = async () => {
    if (!name.trim()) {
      Alert.alert('Champ requis', 'Merci d\'entrer ton prénom pour continuer.');
      return;
    }
    setLoading(true);
    try {
      setLanguage(lang);
      const learnerId = user?.id
        ? `lrn_${user.id}`
        : `lrn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      await createLearner({
        id: learnerId,
        name: name.trim(),
        phone: phone.trim(),
        language: lang,
      });

      if (setDailyGoal) {
        try { await setDailyGoal('lessons', 1); } catch (_) {}
      }
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de creer ton profil.\n\n' + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      enabled={Platform.OS !== 'web'}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 40 }]}
      >
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => { logout().catch(() => {}); }}
          activeOpacity={0.85}
        >
          <Text style={styles.backBtnText}>Retour</Text>
        </TouchableOpacity>

        <View style={styles.logoZone}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>EK</Text>
          </View>
          <Text style={styles.appName}>EduKraft</Text>
          <Text style={styles.tagline}>Bienvenue{name ? ' ' + name : ''} !</Text>
        </View>

        <View style={[styles.card, Shadow.card]}>
          <Text style={styles.formTitle}>Finalise ton profil</Text>
          <Text style={styles.formSub}>Une derniere etape avant de commencer</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Ton prenom *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Kofi, Ama, Moussa..."
              placeholderTextColor={Colors.ink30}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Numero de telephone (optionnel)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 90 XX XX XX"
              placeholderTextColor={Colors.ink30}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Langue d'apprentissage</Text>
            <View style={styles.langRow}>
              {AVAILABLE_LANGUAGES.map(l => (
                <TouchableOpacity
                  key={l.code}
                  style={[styles.langBtn, lang === l.code && styles.langBtnActive]}
                  onPress={() => setLang(l.code)}
                >
                  <Text style={styles.langFlag}>{l.flag}</Text>
                  <Text style={[styles.langLabel, lang === l.code && styles.langLabelActive]}>
                    {l.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.ctaBtn, loading && styles.ctaBtnDisabled, Shadow.button]}
          onPress={handleStart}
          disabled={loading}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>{loading ? 'Creation...' : 'Commencer l\'apprentissage'}</Text>
        </TouchableOpacity>

        <Text style={styles.disclaimer}>
          Tes donnees sont stockees sur ton telephone.{'\n'}
          Tu peux apprendre hors ligne apres cette etape.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.primary },
  scroll: { flexGrow: 1, paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  backBtn: { alignSelf: 'flex-start', paddingVertical: Spacing.sm },
  backBtnText: { fontSize: Typography.body, color: Colors.surface + 'CC', fontWeight: Typography.semibold },
  logoZone: { alignItems: 'center', gap: Spacing.sm },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: Colors.surface + '22',
    alignItems: 'center', justifyContent: 'center',
  },
  logoText: { fontSize: 28, fontWeight: Typography.bold, color: Colors.surface },
  appName: { fontSize: Typography.display, fontWeight: Typography.bold, color: Colors.surface },
  tagline: { fontSize: Typography.body, color: Colors.surface + 'BB' },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.xl, padding: Spacing.lg, gap: Spacing.md },
  formTitle: { fontSize: Typography.h2, fontWeight: Typography.bold, color: Colors.ink },
  formSub: { fontSize: Typography.caption, color: Colors.teal, fontWeight: Typography.semibold, marginTop: -Spacing.sm },
  fieldGroup: { gap: Spacing.xs },
  label: { fontSize: Typography.caption, fontWeight: Typography.semibold, color: Colors.ink60 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
    fontSize: Typography.bodyLg, color: Colors.ink, backgroundColor: Colors.surfaceAlt,
  },
  langRow: { flexDirection: 'row', gap: Spacing.sm },
  langBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    paddingVertical: Spacing.sm, backgroundColor: Colors.surfaceAlt,
  },
  langBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  langFlag: { fontSize: 18 },
  langLabel: { fontSize: Typography.caption, fontWeight: Typography.medium, color: Colors.ink60 },
  langLabelActive: { color: Colors.primary, fontWeight: Typography.bold },
  ctaBtn: { backgroundColor: Colors.surface, borderRadius: Radius.xl, paddingVertical: Spacing.md + 2, alignItems: 'center' },
  ctaBtnDisabled: { opacity: 0.6 },
  ctaText: { fontSize: Typography.bodyLg, fontWeight: Typography.bold, color: Colors.primary },
  disclaimer: { fontSize: Typography.caption, color: Colors.surface + '88', textAlign: 'center', lineHeight: 18 },
});
