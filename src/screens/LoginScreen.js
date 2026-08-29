// src/screens/LoginScreen.js
// Écran de connexion EduKraft — 5 providers + mode hors-ligne.
//
// Providers :
//   1. Email + mot de passe
//   2. Google     — WebBrowser.openAuthSessionAsync (approche impérative, pas de hook)
//   3. Facebook   — WebBrowser.openAuthSessionAsync
//   4. Apple      — expo-apple-authentication.signInAsync (iOS uniquement)
//   5. Phone OTP  — saisie numéro > envoi code > saisie code 6 chiffres > vérif
//
// + Bouton "Continuer hors ligne" (création de profil local sans compte)

import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { t } from '../i18n';
import { useAuth } from '../contexts/AuthContext';

// Imports dynamiques (peuvent ne pas être dispo en web/test)
let WebBrowser = null;
let AppleAuthentication = null;
let AuthSession = null;
try { WebBrowser = require('expo-web-browser'); } catch (_) {}
try { AppleAuthentication = require('expo-apple-authentication'); } catch (_) {}
try { AuthSession = require('expo-auth-session'); } catch (_) {}

// Préparer le redirect URI (Expo proxy — HTTPS, accepté par Google)
// ⚠️ Sur APK standalone, makeRedirectUri peut retourner le scheme natif
// (edukraft://) au lieu du proxy HTTPS. Google REFUSE les custom schemes :
// on garde le proxy HTTPS hardcodé comme redirect_uri envoyé à Google.
// Le returnUrl (2e arg d'openAuthSessionAsync) doit au contraire être le
// SCHEME NATIF : après le détour par auth.expo.io, le navigateur revient à
// edukraft:// et la session se referme proprement.
const EXPO_PROXY_REDIRECT = 'https://auth.expo.io/@orion-k/edukraft';
let GOOGLE_REDIRECT_URI = EXPO_PROXY_REDIRECT;
let FACEBOOK_REDIRECT_URI = EXPO_PROXY_REDIRECT;
let NATIVE_RETURN_URL = 'edukraft://'; // scheme déclaré dans app.json
if (AuthSession) {
  try {
    const proxyRedirect = AuthSession.makeRedirectUri({ useProxy: true });
    // Ne garder le proxy que s'il commence par https (pas un custom scheme)
    if (proxyRedirect && proxyRedirect.startsWith('https://')) {
      GOOGLE_REDIRECT_URI = proxyRedirect;
      FACEBOOK_REDIRECT_URI = proxyRedirect;
    }
    // returnUrl natif = scheme de l'app (fallback 'edukraft://')
    const nativeUri = AuthSession.makeRedirectUri({});
    if (nativeUri && nativeUri.startsWith('edukraft://')) NATIVE_RETURN_URL = nativeUri;
  } catch (_) {}
}

// Client ID Google — résolution : EXPO_PUBLIC_GOOGLE_CLIENT_ID (EAS/.env) >
// valeur par défaut (publique, sans secret). évite l'alerte "non configuré"
// en Expo Go quand aucun .env n'est présent.
const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
  '627774206464-ktg1e33crrdq398e6hiunvlg9pucf1j7.apps.googleusercontent.com';
const FACEBOOK_APP_ID  = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID || '';
const PHONE_OTP_ENABLED = process.env.EXPO_PUBLIC_PHONE_OTP_ENABLED !== 'false';

export default function LoginScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { login, loginGoogle, loginApple, loginFacebook, loginPhone, skip, error, clearError } = useAuth();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading]   = useState(false);
  const [oauthLoading, setOauthLoading] = useState(null);

  // ── Détecter le hash fragment #id_token=... au chargement (retour Google OAuth web) ──
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.substring(1); // retirer le #
      const params = new URLSearchParams(hash);
      const idToken = params.get('id_token');
      if (idToken) {
        // Nettoyer le hash
        window.history.replaceState(null, '', window.location.pathname);
        // Connecter avec le token puis aller à l'Onboarding (pré-rempli)
        setOauthLoading('google');
        loginGoogle(idToken).then(() => {
          navigation?.navigate('Onboarding');
        }).catch(e => {
          Alert.alert(t('auth.oauth_error'), e.message);
        }).finally(() => setOauthLoading(null));
      }
    }
  }, []);

  // Phone OTP state
  const [phone, setPhone]           = useState('');
  const [otpCode, setOtpCode]       = useState('');
  const [otpStep, setOtpStep]       = useState('phone'); // 'phone' | 'code'
  const [otpLoading, setOtpLoading] = useState(false);
  const [devCode, setDevCode]       = useState(null);   // code affiché en mode mock

  const codeInputs = useRef([]);

  // ── Email / password ────────────────────────────────────────────────────
  const handleEmailLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert(t('auth.error_email_required'), t('auth.error_password_required'));
      return;
    }
    setLoading(true);
    try {
      await login({ email: email.trim(), password });
      // Succès → Onboarding pré-rempli (le learner local sera créé là-bas)
      navigation?.navigate('Onboarding');
    } catch (e) {
      const msg = e.message || '';
      // Message plus clair pour les erreurs réseau
      if (msg.includes('Network') || msg.includes('fetch') || msg.includes('Failed')) {
        Alert.alert(
          'Serveur indisponible',
          'Impossible de joindre le serveur.\n\n' +
          'Vérifiez votre connexion internet.\n' +
          'Si le problème persiste, le serveur backend n\'est peut-être pas encore déployé.\n\n' +
          'Vérifiez votre connexion internet et réessayez.',
        );
      } else {
        Alert.alert(t('auth.error_invalid_credentials'), msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Google OAuth (approche impérative) ───────────────────────────────────
  const handleGoogle = async () => {
    if (!GOOGLE_CLIENT_ID) {
      Alert.alert('Google', 'OAuth Google non configuré. Ajoutez EXPO_PUBLIC_GOOGLE_CLIENT_ID.');
      return;
    }
    setOauthLoading('google');
    clearError();
    try {
      const isWebPlatform = Platform.OS === 'web';
      let redirectUri;

      if (isWebPlatform && typeof window !== 'undefined') {
        // Web : utiliser window.location.origin + redirect avec hash fragment
        redirectUri = window.location.origin;

        // En web, on utilise une redirection pleine page (pas de popup)
        // Google renvoie id_token dans le hash fragment (#id_token=...)
        const authUrl = [
          'https://accounts.google.com/o/oauth2/v2/auth',
          `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}`,
          `&redirect_uri=${encodeURIComponent(redirectUri)}`,
          '&response_type=id_token',
          '&scope=openid%20email%20profile',
          '&nonce=' + Math.random().toString(36).slice(2),
        ].join('');

        // Redirection pleine page — Google reviendra avec #id_token=...
        window.location.href = authUrl;
        return; // La page va se recharger
      }

      // Natif : utiliser WebBrowser.openAuthSessionAsync avec le proxy Expo
      if (!WebBrowser) {
        Alert.alert('Google', 'WebBrowser non disponible.');
        setOauthLoading(null);
        return;
      }

      const authUrl = [
        'https://accounts.google.com/o/oauth2/v2/auth',
        `?client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}`,
        `&redirect_uri=${encodeURIComponent(GOOGLE_REDIRECT_URI)}`,
        '&response_type=id_token',
        '&scope=openid%20email%20profile',
        '&nonce=' + Math.random().toString(36).slice(2),
      ].join('');

      const result = await WebBrowser.openAuthSessionAsync(authUrl, NATIVE_RETURN_URL);
      if (result.type !== 'success' || !result.params.id_token) {
        setOauthLoading(null);
        return;
      }
      await loginGoogle(result.params.id_token);
      navigation?.navigate('Onboarding');
    } catch (e) {
      Alert.alert(t('auth.oauth_error'), e.message);
    } finally {
      setOauthLoading(null);
    }
  };

  // ── Facebook OAuth (approche impérative) ─────────────────────────────────
  const handleFacebook = async () => {
    if (!FACEBOOK_APP_ID || !WebBrowser) {
      Alert.alert('Facebook', 'OAuth Facebook non configuré. Ajoutez EXPO_PUBLIC_FACEBOOK_APP_ID.');
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
      ].join('');

      const result = await WebBrowser.openAuthSessionAsync(authUrl, NATIVE_RETURN_URL);
      if (result.type !== 'success' || !result.params.access_token) {
        setOauthLoading(null);
        return;
      }
      await loginFacebook(result.params.access_token);
      navigation?.navigate('Onboarding');
    } catch (e) {
      Alert.alert(t('auth.oauth_error'), e.message);
    } finally {
      setOauthLoading(null);
    }
  };

  // ── Apple Sign-In (iOS uniquement) ───────────────────────────────────────
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
      if (!credential.identityToken) {
        throw new Error('identityToken manquant');
      }
      await loginApple({
        identityToken: credential.identityToken,
        authorizationCode: credential.authorizationCode,
      });
      navigation?.navigate('Onboarding');
    } catch (e) {
      if (e.code !== 'ERR_CANCELED') {
        Alert.alert(t('auth.oauth_error'), e.message);
      }
    } finally {
      setOauthLoading(null);
    }
  };

  // ── Phone OTP ────────────────────────────────────────────────────────────
  const handleSendCode = async () => {
    const cleaned = phone.replace(/[\s+()-]/g, '');
    if (!/^\d{8,15}$/.test(cleaned)) {
      Alert.alert(t('auth.error_phone_invalid'), t('auth.phone_placeholder'));
      return;
    }
    setOtpLoading(true);
    try {
      const data = await loginPhone({ phone: cleaned, action: 'send' });
      setOtpStep('code');
      if (data.devCode) setDevCode(data.devCode);
      Alert.alert(t('auth.code_sent'), data.devCode
        ? `Code de test : ${data.devCode}`
        : t('auth.code_sent'));
    } catch (e) {
      Alert.alert(t('auth.otp_send_error'), e.message);
    } finally {
      setOtpLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (otpCode.length !== 6) {
      Alert.alert(t('auth.error_code_invalid'), t('auth.code_placeholder'));
      return;
    }
    setOtpLoading(true);
    try {
      const cleaned = phone.replace(/[\s+()-]/g, '');
      await loginPhone({ phone: cleaned, action: 'verify', code: otpCode });
      // v1.1 : OTP vérifié → Onboarding pré-rempli avec le téléphone
      navigation?.navigate('Onboarding');
    } catch (e) {
      Alert.alert(t('auth.otp_verify_error'), e.message);
    } finally {
      setOtpLoading(false);
    }
  };

  // ── Skip (mode hors-ligne) ─────────────────────────────────────────────
  const handleSkip = async () => {
    try { await skip(); } catch (e) { console.warn('[Login] skip error:', e.message); }
    // v1.1 : mode hors-ligne → Onboarding (création du learner local sans compte)
    navigation?.navigate('Onboarding');
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
          <Text style={styles.tagline}>{t('auth.login_subtitle')}</Text>
        </View>

        {/* Email / password card */}
        <View style={[styles.card, Shadow.card]}>
          <Text style={styles.formTitle}>{t('auth.login_title')}</Text>

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
              onSubmitEditing={handleEmailLogin}
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, loading && styles.btnDisabled, Shadow.button]}
            onPress={handleEmailLogin}
            disabled={loading || !!oauthLoading}
            activeOpacity={0.85}
          >
            {loading
              ? <ActivityIndicator color={Colors.surface} />
              : <Text style={styles.primaryBtnText}>{t('auth.login_button')}</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => navigation?.navigate('Register')}>
            <Text style={styles.linkText}>
              {t('auth.no_account')}{' '}
              <Text style={styles.linkAction}>{t('auth.register_link')}</Text>
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
            label="G"
            bgColor="#fff"
            textColor="#3C4043"
            borderColor={Colors.border}
            loading={oauthLoading === 'google'}
            onPress={handleGoogle}
            accessibilityLabel={t('auth.google')}
          />
          <OAuthButton
            label="f"
            bgColor="#1877F2"
            textColor="#fff"
            loading={oauthLoading === 'facebook'}
            onPress={handleFacebook}
            accessibilityLabel={t('auth.facebook')}
          />
          {/* v1.1 : Apple Sign-In STRICTEMENT iOS — masqué sur Android/Web */}
          {AppleAuthentication && Platform.OS === 'ios' && (
            <OAuthButton
              label=""
              bgColor="#000"
              textColor="#fff"
              icon="apple"
              loading={oauthLoading === 'apple'}
              onPress={handleApple}
              accessibilityLabel={t('auth.apple')}
            />
          )}
        </View>

        {/* Phone OTP */}
        {PHONE_OTP_ENABLED && (
          <View style={[styles.card, Shadow.card, { marginTop: Spacing.md }]}>
            <Text style={styles.formTitle}>{t('auth.phone_title')}</Text>

            {otpStep === 'phone' ? (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>{t('auth.phone_label')}</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={t('auth.phone_placeholder')}
                    placeholderTextColor={Colors.ink30}
                    value={phone}
                    onChangeText={setPhone}
                    keyboardType="phone-pad"
                    returnKeyType="done"
                  />
                </View>
                <TouchableOpacity
                  style={[styles.secondaryBtn, otpLoading && styles.btnDisabled]}
                  onPress={handleSendCode}
                  disabled={otpLoading}
                  activeOpacity={0.85}
                >
                  {otpLoading
                    ? <ActivityIndicator color={Colors.primary} />
                    : <Text style={styles.secondaryBtnText}>{t('auth.send_code')}</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>{t('auth.code_label')}</Text>
                  <TextInput
                    ref={r => { codeInputs.current[0] = r; }}
                    style={[styles.input, styles.codeInput]}
                    placeholder={t('auth.code_placeholder')}
                    placeholderTextColor={Colors.ink30}
                    value={otpCode}
                    onChangeText={setOtpCode}
                    keyboardType="number-pad"
                    maxLength={6}
                    returnKeyType="done"
                    onSubmitEditing={handleVerifyCode}
                  />
                  {devCode && (
                    <Text style={styles.devCodeHint}>
                      Code de test : {devCode}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[styles.secondaryBtn, otpLoading && styles.btnDisabled]}
                  onPress={handleVerifyCode}
                  disabled={otpLoading}
                  activeOpacity={0.85}
                >
                  {otpLoading
                    ? <ActivityIndicator color={Colors.primary} />
                    : <Text style={styles.secondaryBtnText}>{t('auth.verify_code')}</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { setOtpStep('phone'); setOtpCode(''); setDevCode(null); }}
                >
                  <Text style={styles.linkTextSmall}>{t('auth.resend_code')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* Continuer hors ligne */}
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={handleSkip}
          activeOpacity={0.7}
        >
          <Text style={styles.skipText}>{t('auth.skip')}</Text>
          <Text style={styles.skipSub}>{t('auth.skip_description')}</Text>
        </TouchableOpacity>

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
  codeInput: { textAlign: 'center', fontSize: Typography.h2, letterSpacing: 8 },
  devCodeHint: { fontSize: Typography.tiny, color: Colors.warning, marginTop: 2 },
  primaryBtn: {
    backgroundColor: Colors.primary, borderRadius: Radius.lg,
    paddingVertical: Spacing.md + 2, alignItems: 'center',
  },
  primaryBtnText: { fontSize: Typography.bodyLg, fontWeight: Typography.bold, color: Colors.surface },
  secondaryBtn: {
    backgroundColor: Colors.surface, borderRadius: Radius.lg,
    paddingVertical: Spacing.md, alignItems: 'center',
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  secondaryBtnText: { fontSize: Typography.body, fontWeight: Typography.semibold, color: Colors.primary },
  btnDisabled: { opacity: 0.6 },
  linkText: { fontSize: Typography.caption, color: Colors.ink50, textAlign: 'center', marginTop: Spacing.xs },
  linkTextSmall: { fontSize: Typography.tiny, color: Colors.primary, textAlign: 'center', marginTop: Spacing.sm },
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
  skipBtn: { alignItems: 'center', paddingVertical: Spacing.md, marginTop: Spacing.sm },
  skipText: { fontSize: Typography.body, fontWeight: Typography.semibold, color: Colors.primary },
  skipSub: { fontSize: Typography.tiny, color: Colors.ink30, marginTop: 2, textAlign: 'center' },
  errorBanner: {
    backgroundColor: Colors.coralLight, borderRadius: Radius.md,
    padding: Spacing.md, marginTop: Spacing.sm,
  },
  errorText: { fontSize: Typography.caption, color: Colors.error, textAlign: 'center' },
});
