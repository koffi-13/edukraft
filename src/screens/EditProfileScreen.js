// src/screens/EditProfileScreen.js
// Écran de complétion / édition du profil étendu (v1.1).
//
// Champs : photo, prénom, nom, sexe, date de naissance, niveau d'étude,
// pays, état, ville, adresse, email, téléphone, profession, bio.
//
// La photo utilise expo-image-picker (sélection galerie) avec resize
// automatique pour limiter à ~150 Ko (base64). Compression via
// expo-image-manipulator si disponible (sinon fallback ImagePicker q=0.3).
// La date de naissance utilise un input texte formaté "JJ / MM / AAAA"
// avec séparateurs automatiques, stocké au format ISO "YYYY-MM-DD".
// Le header (retour + titre) est fixe (sticky), en dehors du ScrollView.

import React, { useState, useEffect, useRef } from 'react';
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

let ImageManipulator = null;
try { ImageManipulator = require('expo-image-manipulator'); } catch (_) {}

// ── Helpers : formatage de la date de naissance ───────────────────────────────
// Affichage : "JJ / MM / AAAA" avec séparateurs auto-insérés.
// Stockage  : "YYYY-MM-DD" (format backend).

/**
 * Formate le texte saisi en "JJ / MM / AAAA" avec séparateurs auto.
 * - "1"          -> "1"
 * - "15"         -> "15 / "      (séparateur après 2 chiffres)
 * - "150"        -> "15 / 0"
 * - "1505"       -> "15 / 05 / " (séparateur après 4 chiffres)
 * - "15051990"   -> "15 / 05 / 1990"
 * @param {string} text
 * @returns {string}
 */
function formatDateInput(text) {
  const digits = (text || '').replace(/\D/g, '').slice(0, 8);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  if (digits.length < 2) return dd;                         // "1"
  if (digits.length === 2) return dd + ' / ';               // "15 / "
  if (digits.length < 4) return dd + ' / ' + mm;            // "15 / 0"
  if (digits.length === 4) return dd + ' / ' + mm + ' / ';  // "15 / 05 / "
  return dd + ' / ' + mm + ' / ' + yyyy;                    // "15 / 05 / 1990"
}

/**
 * Convertit le texte formaté en ISO "YYYY-MM-DD".
 * Retourne '' si la date est incomplète (< 8 chiffres).
 * @param {string} text
 * @returns {string}
 */
function parseDateInput(text) {
  const digits = (text || '').replace(/\D/g, '').slice(0, 8);
  if (digits.length !== 8) return '';
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  return yyyy + '-' + mm + '-' + dd;
}

/**
 * Convertit un ISO "YYYY-MM-DD" en affichage "JJ / MM / AAAA".
 * Retourne '' si l'entrée n'est pas au format attendu.
 * @param {string} iso
 * @returns {string}
 */
function isoToDisplay(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  return m[3] + ' / ' + m[2] + ' / ' + m[1];
}

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

const MAX_PHOTO_BYTES = 250000; // 250 Ko base64 (~190 Ko binaire)

export default function EditProfileScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { learner, updateProfile } = useDb();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({});
  const [dateDisplay, setDateDisplay] = useState('');
  const [hasChanges, setHasChanges] = useState(false);

  // Référence vers le formulaire initial (pour détecter les changements)
  const initialFormRef = useRef(null);
  // Référence vers le dernier asset image sélectionné (pour compression)
  const lastPickedAssetRef = useRef(null);

  // ── Chargement initial du formulaire depuis le learner ──────────────────────
  useEffect(() => {
    if (!learner) return;
    const initialForm = {
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
    };
    setForm(initialForm);
    initialFormRef.current = { ...initialForm };
    setDateDisplay(isoToDisplay(initialForm.birth_date));
    setHasChanges(false);
  }, [learner]);

  // ── Détection des changements (hasChanges) ─────────────────────────────────
  useEffect(() => {
    if (!initialFormRef.current) return;
    setHasChanges(
      JSON.stringify(form) !== JSON.stringify(initialFormRef.current)
    );
  }, [form]);

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));

  const handleDateChange = (text) => {
    const formatted = formatDateInput(text);
    setDateDisplay(formatted);
    setField('birth_date', parseDateInput(formatted));
  };

  // ── Navigation : retour avec alerte si changements non enregistrés ──────────
  const goBack = () => {
    if (navigation && typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
      navigation.goBack();
    } else if (navigation && typeof navigation.navigate === 'function') {
      navigation.navigate('Main');
    }
  };

  const handleBack = () => {
    if (!hasChanges) {
      goBack();
      return;
    }
    Alert.alert(
      'Modifications non enregistrées',
      'Voulez-vous enregistrer vos modifications avant de quitter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Quitter sans enregistrer',
          style: 'destructive',
          onPress: () => goBack(),
        },
        {
          text: 'Enregistrer',
          onPress: async () => {
            const ok = await saveProfile();
            if (ok) goBack();
          },
        },
      ]
    );
  };

  // ── Sauvegarde du profil ────────────────────────────────────────────────────
  const saveProfile = async () => {
    setSaving(true);
    try {
      await updateProfile(form);
      return true;
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de sauvegarder: ' + (e?.message || e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const ok = await saveProfile();
    if (ok) {
      Alert.alert('Profil mis à jour', 'Vos informations ont été enregistrées.', [
        { text: 'OK', onPress: () => goBack() },
      ]);
    }
  };

  // ── Sélection & compression de la photo ────────────────────────────────────
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
      if (result.canceled || !result.assets || !result.assets[0]) return;
      const asset = result.assets[0];
      // Mémoriser l'asset pour permettre la compression ultérieure
      lastPickedAssetRef.current = asset;

      if (asset.base64) {
        const base64Data = asset.base64;
        // Si la photo est trop volumineuse (> 250 Ko), proposer de la compresser
        if (base64Data.length > MAX_PHOTO_BYTES) {
          Alert.alert(
            'Photo volumineuse',
            'Cette photo fait ' + Math.round(base64Data.length / 1024) + ' Ko. ' +
            'Voulez-vous la compresser automatiquement (recommandé) ou en choisir une autre ?',
            [
              { text: 'Choisir une autre', style: 'cancel', onPress: () => pickPhoto() },
              { text: 'Compresser', onPress: () => compressPickedPhoto() },
            ]
          );
          return;
        }
        setField('photo_url', `data:image/jpeg;base64,${base64Data}`);
      } else if (asset.uri) {
        // Pas de base64 (web parfois) — on utilise directement l'URI
        setField('photo_url', asset.uri);
      }
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de charger la photo: ' + (e?.message || e));
    }
  };

  /**
   * Compresse la photo déjà sélectionnée (lastPickedAssetRef).
   * 1) Tente expo-image-manipulator sur l'URI déjà sélectionnée (sans relancer le picker).
   * 2) Fallback : relance ImagePicker avec quality 0.3 (comportement historique).
   */
  const compressPickedPhoto = async () => {
    try {
      let compressedBase64 = null;

      // 1) Tenter expo-image-manipulator sur l'URI déjà sélectionnée
      if (ImageManipulator && lastPickedAssetRef.current && lastPickedAssetRef.current.uri) {
        const manipResult = await ImageManipulator.manipulateAsync(
          lastPickedAssetRef.current.uri,
          [{ resize: { width: 300 } }],
          { compress: 0.3, format: 'jpeg', base64: true }
        );
        compressedBase64 = (manipResult && manipResult.base64) || null;
      }

      // 2) Fallback : relancer ImagePicker avec une qualité plus faible
      if (!compressedBase64 && ImagePicker) {
        const compressed = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.3,
          base64: true,
        });
        if (!compressed.canceled && compressed.assets && compressed.assets[0] && compressed.assets[0].base64) {
          compressedBase64 = compressed.assets[0].base64;
          lastPickedAssetRef.current = compressed.assets[0];
        }
      }

      if (!compressedBase64) return;

      if (compressedBase64.length > MAX_PHOTO_BYTES) {
        Alert.alert(
          'Toujours trop volumineuse',
          'La photo compressée fait encore ' + Math.round(compressedBase64.length / 1024) +
          ' Ko. Veuillez choisir une photo plus petite.'
        );
        return;
      }
      setField('photo_url', `data:image/jpeg;base64,${compressedBase64}`);
    } catch (e) {
      Alert.alert('Erreur', 'Compression impossible : ' + (e?.message || e));
    }
  };

  const selectedCountry = COUNTRIES.find(c => c.code === form.country) || COUNTRIES[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Header fixe (sticky) — hors ScrollView */}
      <View style={styles.stickyHeader}>
        <TouchableOpacity onPress={handleBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('profile.edit_title')}</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
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

          {/* Date de naissance — input formaté "JJ / MM / AAAA" */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('profile.birth_date')}</Text>
            <TextInput
              style={styles.input}
              value={dateDisplay}
              onChangeText={handleDateChange}
              placeholder="JJ / MM / AAAA"
              placeholderTextColor={Colors.ink30}
              keyboardType="numeric"
              maxLength={14}
            />
          </View>

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

          {/* Téléphone avec préfixe du pays — form.phone mappé à la clé 'phone' attendue côté backend */}
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
    </View>
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
  stickyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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
