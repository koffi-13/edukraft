// src/screens/RegisterScreen.js
// Écran d'inscription EduKraft — même approche OAuth impérative que LoginScreen.
//
// Champs : displayName, email, password, langue (FR / Ewe)
// OAuth : Google, Facebook (WebBrowser), Apple (iOS)
// Lien vers Login si compte existant

import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { t, setLanguage, AVAILABLE_LANGUAGES } from '../i18n';
import { useAuth } from '../contexts/AuthContext';
import { useDb } from '../database/DbProvider';
import ENV from '../config/env';

// Imports dynamiques (peuvent ne pas être dispo en web/test)
let WebBrowser = null;
let AppleAuthentication = null;
let AuthSession = null;
try { WebBrowser = require('expo-web-browser'); } catch (_) {}
try { AppleAuthentication = require('expo-apple-authentication'); } catch (_) {}
try { AuthSession = require('expo-auth-session'); } catch (_) {}

// ── OAuth via relais HTTPS maison (v1.1.2) — voir LoginScreen pour le détail ──
// Le proxy Expo (auth.expo.io) exige un projet enregistré chez Expo (404 sur
// api.expo.dev pour @orion-k/edukraft) : le backend Render sert une page
// relais /api/auth/{google,facebook}/callback qui renvoie les tokens vers le
// scheme de l'app via le paramètre `state` (aller-retour OAuth standard).
const GOOGLE_REDIRECT_URI = ENV.API_BASE + '/api/auth/google/callback';
const FACEBOOK_REDIRECT_URI = ENV.API_BASE + '/api/auth/facebook/callback';

// returnUrl natif : scheme de l'app en APK (edukraft://) ou URL Expo Go (exp://...)
let NATIVE_RETURN_URL = 'edukraft://'; // scheme déclaré dans app.json
if (AuthSession) {
  try {
    const nativeUri = AuthSession.makeRedirectUri({});
    if (nativeUri && (
      nativeUri.startsWith('edukraft://') ||
      nativeUri.startsWith('exp://') ||
      nativeUri.startsWith('https://exp.direct')
    )) {
      NATIVE_RETURN_URL = nativeUri;
    }
  } catch (_) {}
}

// Parse les paramètres (query OU fragment) d'une URL de retour OAuth.
// openAuthSessionAsync renvoie { type, url } — PAS de champ `params` :
// l'ancien `result.params.id_token` levait un TypeError silencieux.
function parseAuthResultParams(url) {
  const out = {};
  if (!url || typeof url !== 'string') return out;
  const parts = url.split(/[?#]/).slice(1);
  parts.forEach(part => {
    (part || '').split('&').forEach(kv => {
      if (!kv) return;
      const eq = kv.indexOf('=');
      if (eq < 0) { out[decodeURIComponent(kv)] = ''; return; }
      const k = decodeURIComponent(kv.slice(0, eq));
      const v = decodeURIComponent(kv.slice(eq + 1));
      if (!(k in out)) out[k] = v;
    });
  });
  return out;
}

// v1.1 : fallback public du Client ID Google (évite "non configuré" sans .env)
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
  '627774206464-ktg1e33crrdq398e6hiunvlg9pucf1j7.apps.googleusercontent.com';
const FACEBOOK_APP_ID  = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID || '';

export default function RegisterScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { register, loginGoogle, loginApple, loginFacebook, error, clearError } = useAuth();
  const { learner, linkLearnerToAccount } = useDb();

  // v1.1.3 : `fromLogout` — inscription demandée depuis le Profil (invité qui
  // veut se déconnecter) : après l'inscription, on LIE le learner local au
  // compte (progression conservée) et on revient au Profil au lieu d'aller
  // à l'Onboarding (le profil existe déjà).
  const fromLogout = !!(route?.params?.fromLogout);

  const [name, setName]           = useState(learner?.name || '');
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [lang, setLang]           = useState(learner?.language || 'fr');
  const [loading, setLoading]     = useState(false);
  const [oauthLoading, setOauthLoading] = useState(null);

  // ── Après une authentification réussie ───────────────────────────────
  // v1.1.3 : si un learner local existe déjà (invité / utilisateur
  // déconnecté), on le LIE au compte et on NE PASSE PAS par l'Onboarding —
  // ses données sont restaurées directement. Sinon, Onboarding normal.
  const afterAuthSuccess = async (authData) => {
    if (learner) {
      try {
        await linkLearnerToAccount(authData?.user || authData);
      } catch (_) {}
      if (fromLogout) {
        Alert.alert(
          'Compte créé ✓',
          'Tes données sont maintenant rattachées à ton compte. Tu peux te déconnecter : elles seront restaurées automatiquement à ta prochaine connexion.',
          [{ text: 'OK', onPress: () => navigation?.goBack() }],
        );
        return;
      }
      // Connexion classique avec learner existant : le gating bascule
      // automatiquement vers le Dashboard (sessionEnded retiré par
      // handleAuthSuccess).
      return;
    }
    navigation?.navigate('Onboarding');
  };

  // ── Inscription email ────────────────────────────────────────────────────
  const handleRegister = async () => {
    if (!name.trim()) {
      Alert.alert(t('auth.error_name_required'), t('auth.name_placeholder'));
      return;
    }
    if (!email.trim()) {
      Alert.alert(t('auth.error_email_required'), t('auth.email_placeholder'));
      return;
    }
    if (password.length < 6) {
      Alert.alert(t('auth.error_password_short'), t('auth.error_password_short'));
      return;
    }
    setLoading(true);
    try {
      setLanguage(lang);
      const data = await register({
        displayName: name.trim(),
        email: email.trim(),
        password,
        language: lang,
      });
      // v1.1.3 : learner existant → liaison + retour ; sinon → Onboarding
      await afterAuthSuccess(data);
    } catch (e) {
      Alert.alert(t('auth.error_generic'), e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Google OAuth ──────────────────────────────────────────────────────────
  const handleGoogle = async () => {
    if (!GOOGLE_CLIENT_ID || !WebBrowser) {
      Alert.alert('Google', 'OAuth Google non configuré.');
      return;
    }
    setOauthLoading('google');
    clearError();
    try {
      const isWebPlatform = Platform.OS === 'web';
      const redirectUri = isWebPlatform && typeof window !== 'undefined'
        ? window.location.origin
        : GOOGLE_REDIRECT_URI;

      const authUrl = [
        'https://accounts.google.com/o/oauth2/v2/auth',
        `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}`,
        `&redirect_uri=${encodeURIComponent(redirectUri)}`,
        '&response_type=id_token',
        '&scope=openid%20email%20profile',
        `&state=${encodeURIComponent(NATIVE_RETURN_URL)}`,
        '&nonce=' + Math.random().toString(36).slice(2),
      ].join('');
      const result = await WebBrowser.openAuthSessionAsync(authUrl, NATIVE_RETURN_URL);
      if (result.type !== 'success' || !result.url) {
        setOauthLoading(null);
        return;
      }
      const params = parseAuthResultParams(result.url);
      if (params.error) {
        if (params.error !== 'access_denied') {
          throw new Error(params.error);
        }
        setOauthLoading(null);
        return;
      }
      if (!params.id_token) {
        throw new Error('id_token absent de la reponse Google');
      }
      await loginGoogle(params.id_token);
      await afterAuthSuccess(null);
    } catch (e) {
      Alert.alert(t('auth.oauth_error'), e.message);
    } finally {
      setOauthLoading(null);
    }
  };

  // ── Facebook OAuth ────────────────────────────────────────────────────────
  const handleFacebook = async () => {
    if (!FACEBOOK_APP_ID || !WebBrowser) {
      Alert.alert('Facebook', 'OAuth Facebook non configuré.');
      return;
    }
    setOauthLoading('facebook');
    clearError();
    try {
      const authUrl = [
        'https://www.facebook.com/v18.0/dialog/oauth',
        `?client_id=${encodeURIComponent(FACEBOOK_APP_ID)}`,
        `&redirect_uri=${encodeURIComponent(FACEBOOK_REDIRECT_URI)}`,
        '&response_type=token',
        '&scope=email,public_profile',
        `&state=${encodeURIComponent(NATIVE_RETURN_URL)}`,
      ].join('');
      const result = await WebBrowser.openAuthSessionAsync(authUrl, NATIVE_RETURN_URL);
      if (result.type !== 'success' || !result.url) {
        setOauthLoading(null);
        return;
      }
      const params = parseAuthResultParams(result.url);
      if (params.error && params.error !== 'access_denied') {
        throw new Error(params.error);
      }
      if (!params.access_token) {
        setOauthLoading(null);
        return;
      }
      await loginFacebook(params.access_token);
      await afterAuthSuccess(null);
    } catch (e) {
      Alert.alert(t('auth.oauth_error'), e.message);
    } finally {
      setOauthLoading(null);
    }
  };

  // ── Apple Sign-In ─────────────────────────────────────────────────────────
  const handleApple = async () => {
    if (!AppleAuthentication) {
      Alert.alert('Apple Sign-In', 'Disponible uniquement sur iOS.');
      return;
    }
    setOauthLoading('apple');
    clearError();
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!credential.identityToken) throw new Error('identityToken manquant');
      await loginApple({
        identityToken: credential.identityToken,
        authorizationCode: credential.authorizationCode,
      });
      await afterAuthSuccess(null);
    } catch (e) {
      if (e.code !== 'ERR_CANCELED') {
        Alert.alert(t('auth.oauth_error'), e.message);
      }
    } finally {
      setOauthLoading(null);
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
        contentContainerStyle={[styles.scroll, {
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 32,
        }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={styles.logoZone}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>EK</Text>
          </View>
          <Text style={styles.appName}>EduKraft</Text>
          <Text style={styles.tagline}>{t('auth.register_subtitle')}</Text>
        </View>

        {/* Form card */}
        <View style={[styles.card, Shadow.card]}>
          <Text style={styles.formTitle}>{t('auth.register_title')}</Text>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.name_label')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth.name_placeholder')}
              placeholderTextColor={Colors.ink30}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              returnKeyType="next"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.email_label')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth.email_placeholder')}
              placeholderTextColor={Colors.ink30}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="next"
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.password_label')}</Text>
            <TextInput
              style={styles.input}
              placeholder={t('auth.password_placeholder')}
              placeholderTextColor={Colors.ink30}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleRegister}
            />
          </View>

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>{t('auth.language_label')}</Text>
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

          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.btnDisabled, Shadow.button]}
            onPress={handleRegister}
            disabled={loading || !!oauthLoading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={Colors.surface} />
              : <Text style={styles.primaryBtnText}>{t('auth.register_button')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation?.navigate('Login')}>
            <Text style={styles.linkText}>
              {t('auth.have_account')}{' '}
              <Text style={styles.linkAction}>{t('auth.login_link')}</Text>
            </Text>
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>{t('auth.or_continue_with')}</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* OAuth buttons */}
        <View style={styles.oauthRow}>
          <OAuthButton
            label="G" bgColor="#fff" textColor="#3C4043" borderColor={Colors.border}
            loading={oauthLoading === 'google'} onPress={handleGoogle}
            accessibilityLabel={t('auth.google')}
          />
          {/* v1.1.1 : Facebook differe — bouton MASQUE tant que l'App ID est vide.
              Il reaparaitra automatiquement des que EXPO_PUBLIC_FACEBOOK_APP_ID
              sera renseigne (eas.json / .env). Plus d'alerte "non configure". */}
          {!!FACEBOOK_APP_ID && (
            <OAuthButton
              label="f" bgColor="#1877F2" textColor="#fff"
              loading={oauthLoading === 'facebook'} onPress={handleFacebook}
              accessibilityLabel={t('auth.facebook')}
            />
          )}
          {/* v1.1 : Apple Sign-In STRICTEMENT iOS — masqué sur Android/Web */}
          {AppleAuthentication && Platform.OS === 'ios' && (
            <OAuthButton
              label="" bgColor="#000" textColor="#fff" icon="apple"
              loading={oauthLoading === 'apple'} onPress={handleApple}
              accessibilityLabel={t('auth.apple')}
            />
          )}
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Sous-composant : bouton OAuth rond ────────────────────────────────────────
function OAuthButton({ label, bgColor, textColor, borderColor, icon, loading, onPress, accessibilityLabel }) {
  return (
    <TouchableOpacity
      style={[styles.oauthBtn, { backgroundColor: bgColor, borderColor: borderColor || 'transparent' }]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
      accessibilityLabel={accessibilityLabel}
    >
      {loading
        ? <ActivityIndicator size="small" color={textColor} />
        : icon === 'apple'
          ? <Text style={[styles.oauthIcon, { color: textColor }]}>Apple</Text>
          : <Text style={[styles.oauthLabel, { color: textColor }]}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1, paddingHorizontal: Spacing.lg, gap: Spacing.md },
  logoZone: { alignItems: 'center', gap: Spacing.xs, marginBottom: Spacing.sm },
  logoCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  logoText: { fontSize: 26, fontWeight: Typography.bold, color: Colors.surface },
  appName: { fontSize: Typography.display, fontWeight: Typography.bold, color: Colors.ink },
  tagline: { fontSize: Typography.caption, color: Colors.ink50 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  formTitle: { fontSize: Typography.h2, fontWeight: Typography.bold, color: Colors.ink },
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
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg,
    paddingVertical: Spacing.md + 2, alignItems: 'center',
  },
  primaryBtnText: { fontSize: Typography.bodyLg, fontWeight: Typography.bold, color: Colors.surface },
  btnDisabled: { opacity: 0.6 },
  linkText: { fontSize: Typography.caption, color: Colors.ink50, textAlign: 'center', marginTop: Spacing.xs },
  linkAction: { color: Colors.primary, fontWeight: Typography.bold },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: Spacing.sm },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { fontSize: Typography.tiny, color: Colors.ink30, marginHorizontal: Spacing.md },
  oauthRow: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.md },
  oauthBtn: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  oauthLabel: { fontSize: 22, fontWeight: Typography.bold },
  oauthIcon: { fontSize: Typography.caption, fontWeight: Typography.bold },
  errorBanner: {
    backgroundColor: Colors.coralLight, borderRadius: Radius.md,
    padding: Spacing.md, marginTop: Spacing.sm,
  },
  errorText: { fontSize: Typography.caption, color: Colors.error, textAlign: 'center' },
});
