import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Alert, Platform } from 'react-native';

// Polyfill Alert pour le WEB (v1.1.3) :
// react-native-web implémente Alert.alert comme un NO-OP ({}), donc aucune
// alerte (déconnexion, confirmation, erreur) ne s'affichait sur web — le
// bouton « Se déconnecter » ne faisait littéralement rien. On remplace donc
// Alert.alert par window.confirm / window.alert, en mappant :
//   • 0-1 bouton  → window.alert (informatif) puis callback du bouton
//   • 2+ boutons  → window.confirm : OK = dernier bouton non-cancel,
//                   Annuler = bouton de style 'cancel'
// Sur natif (Android/iOS), l'Alert système est utilisée (inchangée).
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  Alert.alert = (title, message, buttons = []) => {
    const btns = Array.isArray(buttons) ? buttons.filter(Boolean) : [];

    if (btns.length <= 1) {
      window.alert(`${title || ''}${message ? (title ? '\n\n' : '') + message : ''}`);
      const cb = btns[0]?.onPress;
      if (typeof cb === 'function') cb();
      return;
    }

    // 2+ boutons → confirm (OK / Annuler)
    const cancelBtn = btns.find(b => b.style === 'cancel');
    // Le bouton « positif » : le dernier qui n'est pas cancel (convention RN :
    // le bouton principal est généralement en dernier sur Android)
    const positiveBtns = btns.filter(b => b.style !== 'cancel');
    const positive = positiveBtns[positiveBtns.length - 1] || btns[btns.length - 1];

    const ok = window.confirm(`${title || ''}${message ? (title ? '\n\n' : '') + message : ''}`);
    if (ok) {
      if (typeof positive?.onPress === 'function') positive.onPress();
    } else if (typeof cancelBtn?.onPress === 'function') {
      cancelBtn.onPress();
    }
  };
}

// Polyfill pour TextEncoder dans Hermes
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = require('text-encoding').TextEncoder;
  global.TextDecoder = require('text-encoding').TextDecoder;
}

import { DbProvider } from './src/database/DbProvider';
import { AuthProvider } from './src/contexts/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import { Colors } from './src/theme';
// v1.1.21 (Phase 3) : error reporting + analytics pluggables. No-op si
// EXPO_PUBLIC_SENTRY_DSN / EXPO_PUBLIC_ANALYTICS_PROVIDER ne sont pas
// configurés — aucun impact sur l'app tant que l'utilisateur ne branche
// pas ses clés. Voir src/services/errorReporting.js et analytics.js.
import * as errorReporting from './src/services/errorReporting';
import * as analytics from './src/services/analytics';
// Init au plus tôt : capture les crashes globaux avant tout autre code.
errorReporting.init();
analytics.init();

// Composant interne qui active le SyncEngine une fois la DB prête
function SyncActivator() {
  // Le hook useSyncEngine s'active automatiquement
  // Import dynamique pour éviter les erreurs si expo-network n'est pas dispo
  try {
    const { useSyncEngine } = require('./src/database/syncEngine');
    useSyncEngine(); // active la sync en arrière-plan
  } catch (e) {
    console.warn('[App] SyncEngine non disponible:', e.message);
    errorReporting.captureException(e, { tags: { module: 'App', source: 'SyncActivator' } });
  }
  return null;
}

export default function App() {
  return (
    <DbProvider>
      <AuthProvider>
        <View style={styles.container}>
          <SyncActivator />
          <AppNavigator />
          <StatusBar style="light" backgroundColor={Colors.primary} />
        </View>
      </AuthProvider>
    </DbProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});