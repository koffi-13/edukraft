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

export default function App() {
  return (
    <DbProvider>
      <View style={styles.container}>
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
