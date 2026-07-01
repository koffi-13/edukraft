// src/screens/EditProfileScreen.js
// Écran de complétion / édition du profil étendu (v1.1).
//
// Champs : photo, prénom, nom, sexe, date de naissance, niveau d'étude,
// pays, état, ville, adresse, email, téléphone, profession, bio.
//
// La photo utilise expo-image-picker (sélection galerie) avec resize
// automatique pour limiter à ~150 Ko (base64).
// La date de naissance utilise un DatePicker natif (Android/iOS) ou un
// input texte sur web.

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Platform, Image, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { useDb } from '../database/DbProvider';
import { t } from '../i18n';

// Imports dynamiques (peuvent ne pas être dispo en web/test)
let ImagePicker = null;
try { ImagePicker = require('expo-image-picker'); } catch (_) {}

const COUNTRIES = [
  { code: 'TG', name: 'Togo', phonePrefix: '+228' },
  { code: 'BJ', name: 'Bénin', phonePrefix: '+229' },
  { code: 'CI', name: 'Côte d\'Ivoire', phonePrefix: '+225' },
  { code: 'GH', name: 'Ghana', phonePrefix: '+233' },
  { code: 'BF', name: 'Burkina Faso', phonePrefix: '+226' },
  { code: 'ML', name: 'Mali', phonePrefix: '+223' },
  { code: 'SN', name: 'Sénégal', phonePrefix: '+221' },
  { code: 'NG', name: 'Nigeria', phonePrefix: '+234' },
  { code: 'FR', name: 'France', phonePrefix: '+33' },
  { code: 'OTHER', name: 'Autre', phonePrefix: '+' },
];

const EDUCATION_LEVELS = [
  'Aucun diplôme',
  'CEP / BEPC',
  'CAP / BEP',
  'Bac',
  'Bac +2',
  'Bac +3',
  'Bac +5',
  'Autre',
];

const GENDERS = [
  { value: 'M', label: 'Homme' },
  { value: 'F', label: 'Femme' },
];

export default function EditProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { learner, updateProfile } = useDb();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});

  useEffect(() => {
    if (learner) {
      setForm({
        first_name: learner.first_name || (learner.name || '').split(' ')[0] || '',
        last_name: learner.last_name || (learner.name || '').split(' ').slice(1).join(' ') || '',
        gender: learner.gender || '',
        birth_date: learner.birth_date || '',
        education_level: learner.education_level || '',
        country: learner.country || 'TG',
        state: learner.state || '',
        city: learner.city || '',
        address: learner.address || '',
        email: learner.email || '',
        phone: learner.phone || '',
        profession: learner.profession || '',
        bio: learner.bio || '',
        photo_url: learner.photo_url || '',
      });
    }
  }, [learner]);

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const pickPhoto = async () => {
    if (!ImagePicker) {
      Alert.alert('Photo', 'Sélection de photo non disponible sur cette plateforme.');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.6,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        if (asset.base64) {
          // Limite ~150 Ko (base64 ~200 Ko)
          if (asset.base64.length > 250000) {
            Alert.alert('Photo trop volumineuse', 'Veuillez choisir une photo plus petite (max 200 Ko).');
            return;
          }
          setField('photo_url', `data:image/jpeg;base64,${asset.base64}`);
        }
      }
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de charger la photo: ' + e.message);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile(form);
      Alert.alert('Profil mis à jour', 'Vos informations ont été enregistrées.', [
        { text: 'OK', onPress: () => navigation?.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de sauvegarder: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedCountry = COUNTRIES.find(c => c.code === form.country) || COUNTRIES[0];

  return (
    <ScrollView
      style={[styles.root, { paddingTop: insets.top }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation?.goBack()}>
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.edit_title')}</Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Photo de profil */}
      <View style={styles.photoSection}>
        <TouchableOpacity onPress={pickPhoto} activeOpacity={0.85}>
          {form.photo_url ? (
            <Image source={{ uri: form.photo_url }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]}>
              <Text style={styles.photoPlaceholderText}>
                {form.first_name?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <View style={styles.photoBadge}>
            <Text style={styles.photoBadgeText}>📷</Text>
          </View>
        </TouchableOpacity>
        <Text style={styles.photoHint}>{t('profile.photo_hint')}</Text>
      </View>

      {/* Champs texte de base */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.section_identity')}</Text>
        <Field label={t('profile.first_name')} value={form.first_name} onChange={v => setField('first_name', v)} />
        <Field label={t('profile.last_name')} value={form.last_name} onChange={v => setField('last_name', v)} />

        {/* Sexe */}
        <Text style={styles.label}>{t('profile.gender')}</Text>
        <View style={styles.row}>
          {GENDERS.map(g => (
            <TouchableOpacity
              key={g.value}
              style={[styles.pillBtn, form.gender === g.value && styles.pillBtnActive]}
              onPress={() => setField('gender', g.value)}
            >
              <Text style={[styles.pillText, form.gender === g.value && styles.pillTextActive]}>
                {g.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Date de naissance */}
        <Field
          label={t('profile.birth_date')}
          value={form.birth_date}
          onChange={v => setField('birth_date', v)}
          placeholder="AAAA-MM-JJ (ex: 1990-05-15)"
        />

        {/* Niveau d'étude */}
        <Text style={styles.label}>{t('profile.education_level')}</Text>
        <View style={styles.chipRow}>
          {EDUCATION_LEVELS.map(level => (
            <TouchableOpacity
              key={level}
              style={[styles.chip, form.education_level === level && styles.chipActive]}
              onPress={() => setField('education_level', level)}
            >
              <Text style={[styles.chipText, form.education_level === level && styles.chipTextActive]}>
                {level}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Field label={t('profile.profession')} value={form.profession} onChange={v => setField('profession', v)} placeholder="Ex: Commerçant, Étudiant..." />
      </View>

      {/* Coordonnées */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.section_contact')}</Text>

        {/* Pays */}
        <Text style={styles.label}>{t('profile.country')}</Text>
        <View style={styles.chipRow}>
          {COUNTRIES.map(c => (
            <TouchableOpacity
              key={c.code}
              style={[styles.chip, form.country === c.code && styles.chipActive]}
              onPress={() => setField('country', c.code)}
            >
              <Text style={[styles.chipText, form.country === c.code && styles.chipTextActive]}>
                {c.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Field label={t('profile.state')} value={form.state} onChange={v => setField('state', v)} placeholder="Région / État" />
        <Field label={t('profile.city')} value={form.city} onChange={v => setField('city', v)} placeholder="Ville" />
        <Field label={t('profile.address')} value={form.address} onChange={v => setField('address', v)} placeholder="Quartier, rue, repère" />

        {/* Téléphone avec préfixe du pays */}
        <Text style={styles.label}>{t('profile.phone')}</Text>
        <View style={styles.phoneRow}>
          <Text style={styles.phonePrefix}>{selectedCountry.phonePrefix}</Text>
          <TextInput
            style={styles.phoneInput}
            value={form.phone}
            onChangeText={v => setField('phone', v)}
            placeholder="90 12 34 56"
            placeholderTextColor={Colors.ink30}
            keyboardType="phone-pad"
          />
        </View>

        <Field
          label={t('profile.email')}
          value={form.email}
          onChange={v => setField('email', v)}
          placeholder="ton@email.com"
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>

      {/* Bio */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('profile.section_bio')}</Text>
        <Text style={styles.label}>{t('profile.bio')}</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          value={form.bio}
          onChangeText={v => setField('bio', v)}
          placeholder="Parle-nous de toi, tes objectifs..."
          placeholderTextColor={Colors.ink30}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </View>

      {/* Bouton sauvegarder */}
      <TouchableOpacity
        style={[styles.saveBtn, saving && styles.saveBtnDisabled, Shadow.button]}
        onPress={handleSave}
        disabled={saving}
        activeOpacity={0.85}
      >
        {saving
          ? <ActivityIndicator color={Colors.surface} />
          : <Text style={styles.saveBtnText}>{t('common.save')}</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

// ── Sous-composant : champ texte ─────────────────────────────────────────────
function Field({ label, value, onChange, placeholder, keyboardType, autoCapitalize }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.ink30}
        keyboardType={keyboardType || 'default'}
        autoCapitalize={autoCapitalize || 'words'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backText: { fontSize: Typography.body, color: Colors.primary, fontWeight: Typography.semibold },
  title: { fontSize: Typography.h2, fontWeight: Typography.bold, color: Colors.ink },
  // Photo
  photoSection: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.xs },
  photo: { width: 96, height: 96, borderRadius: 48 },
  photoPlaceholder: {
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: { fontSize: 36, fontWeight: Typography.bold, color: Colors.surface },
  photoBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32, height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBadgeText: { fontSize: 16 },
  photoHint: { fontSize: Typography.tiny, color: Colors.ink30 },
  // Sections
  section: {
    backgroundColor: Colors.surface,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  sectionTitle: {
    fontSize: Typography.h3,
    fontWeight: Typography.bold,
    color: Colors.ink,
    marginBottom: Spacing.xs,
  },
  fieldGroup: { gap: Spacing.xs },
  label: { fontSize: Typography.caption, fontWeight: Typography.semibold, color: Colors.ink60 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: Typography.bodyLg,
    color: Colors.ink,
    backgroundColor: Colors.surfaceAlt,
  },
  textArea: { minHeight: 80, paddingTop: Spacing.sm },
  // Pills (sexe)
  row: { flexDirection: 'row', gap: Spacing.sm },
  pillBtn: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.surfaceAlt,
  },
  pillBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  pillText: { fontSize: Typography.body, color: Colors.ink60, fontWeight: Typography.semibold },
  pillTextActive: { color: Colors.primary, fontWeight: Typography.bold },
  // Chips (pays, éducation)
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: Spacing.xs + 2,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
  },
  chipActive: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  chipText: { fontSize: Typography.caption, color: Colors.ink60 },
  chipTextActive: { color: Colors.primary, fontWeight: Typography.bold },
  // Phone
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  phonePrefix: {
    fontSize: Typography.bodyLg,
    color: Colors.ink60,
    fontWeight: Typography.semibold,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm + 4,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceAlt,
  },
  phoneInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    fontSize: Typography.bodyLg,
    color: Colors.ink,
    backgroundColor: Colors.surfaceAlt,
  },
  // Save
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md + 2,
    alignItems: 'center',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { fontSize: Typography.bodyLg, fontWeight: Typography.bold, color: Colors.surface },
});
