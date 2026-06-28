import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// Polyfill pour TextEncoder dans Hermes
if (typeof TextEncoder === 'undefined') {
  global.TextEncoder = require('text-encoding').TextEncoder;
  global.TextDecoder = require('text-encoding').TextDecoder;
}

import { DbProvider } from './src/database/DbProvider';
import AppNavigator from './src/navigation/AppNavigator';
import { Colors } from './src/theme';

// Composant interne qui active le SyncEngine une fois la DB prête
function SyncActivator() {
  // Le hook useSyncEngine s'active automatiquement
  // Import dynamique pour éviter les erreurs si expo-network n'est pas dispo
  try {
    const { useSyncEngine } = require('./src/database/syncEngine');
    useSyncEngine(); // active la sync en arrière-plan
  } catch (e) {
    console.warn('[App] SyncEngine non disponible:', e.message);
  }
  return null;
}

export default function App() {
  return (
    <DbProvider>
      <View style={styles.container}>
        <SyncActivator />
        <AppNavigator />
        <StatusBar style="light" backgroundColor={Colors.primary} />
      </View>
    </DbProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});