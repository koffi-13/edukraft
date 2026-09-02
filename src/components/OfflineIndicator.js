// src/components/OfflineIndicator.js
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Network from 'expo-network';
import { Colors, Typography, Spacing } from '../theme';
import { t } from '../i18n';

// v1.1.14 : le bandeau « Mode hors-ligne » ne s'affichait PAS COMPLÈTEMENT :
// il était calé à top:0 de l'écran alors que l'app dessine SOUS la barre
// d'état (le header du Dashboard utilise déjà insets.top) → la moitié du
// bandeau restait cachée derrière le statut Android. Désormais il est
// positionné SOUS la zone sûre (insets.top), s'anime depuis au-dessus
// (hauteur + marge), et sa hauteur s'adapte au texte (plus de texte tronqué
// sur petits écrans).
export default function OfflineIndicator() {
  const insets = useSafeAreaInsets();
  const [isOnline, setIsOnline]   = useState(true);
  const [show, setShow]           = useState(false);
  const bannerH = 44;
  const slideAnim = React.useRef(new Animated.Value(-(bannerH + 16))).current;

  useEffect(() => {
    let interval;

    const check = async () => {
      const net = await Network.getNetworkStateAsync().catch(() => ({ isInternetReachable: true }));
      // isInternetReachable peut être null (inconnu) : on ne bascule en
      // hors-ligne QUE sur un false explicite.
      const online = net.isInternetReachable !== false;
      setIsOnline(online);
    };

    check();
    interval = setInterval(check, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isOnline) {
      setShow(true);
      Animated.spring(slideAnim, {
        toValue: 0, useNativeDriver: true, tension: 80, friction: 10,
      }).start();
    } else if (show) {
      Animated.timing(slideAnim, {
        toValue: -(bannerH + 16), duration: 300, useNativeDriver: true,
      }).start(() => setShow(false));
    }
  }, [isOnline, show, slideAnim]);

  if (!show) return null;

  return (
    <Animated.View
      style={[
        styles.bar,
        { top: insets.top, minHeight: bannerH, transform: [{ translateY: slideAnim }] },
      ]}
    >
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={2} ellipsizeMode="tail">
        {t('dashboard.offline_banner')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position:        'absolute',
    left:            0,
    right:           0,
    backgroundColor: Colors.amber,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    zIndex:          999,
    elevation:       999, // Android : par-dessus le contenu
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  dot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: Colors.surface,
  },
  text: {
    color:      Colors.surface,
    fontSize:   Typography.caption,
    fontWeight: Typography.semibold,
    flexShrink: 1,
    textAlign:  'center',
  },
});
