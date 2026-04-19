// src/components/OfflineIndicator.js
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import * as Network from 'expo-network';
import { Colors, Typography, Spacing } from '../theme';
import { t } from '../i18n';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline]   = useState(true);
  const [show, setShow]           = useState(false);
  const slideAnim = React.useRef(new Animated.Value(-48)).current;

  useEffect(() => {
    let interval;

    const check = async () => {
      const net = await Network.getNetworkStateAsync().catch(() => ({ isInternetReachable: true }));
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
        toValue: -48, duration: 300, useNativeDriver: true,
      }).start(() => setShow(false));
    }
  }, [isOnline]);

  if (!show) return null;

  return (
    <Animated.View style={[styles.bar, { transform: [{ translateY: slideAnim }] }]}>
      <View style={styles.dot} />
      <Text style={styles.text}>{t('dashboard.offline_banner')}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position:        'absolute',
    top:             0,
    left:            0,
    right:           0,
    height:          40,
    backgroundColor: Colors.amber,
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             8,
    zIndex:          999,
    paddingHorizontal: Spacing.md,
  },
  dot: {
    width:           8,
    height:          8,
    borderRadius:    4,
    backgroundColor: Colors.white,
  },
  text: {
    color:      Colors.white,
    fontSize:   Typography.caption,
    fontWeight: Typography.semibold,
  },
});
