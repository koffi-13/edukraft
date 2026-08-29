// src/components/XPBar.js
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Colors, Typography, Spacing, Radius, getLevel } from '../theme';
import { t } from '../i18n';

export default function XPBar({ xp, compact = false }) {
  const { current, next, progress } = getLevel(xp);
  const widthAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue:         progress,
      duration:        800,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  if (compact) {
    return (
      <View style={styles.compactRow}>
        <View style={[styles.levelBadge, { backgroundColor: current.color + '22' }]}>
          <Text style={[styles.levelText, { color: current.color }]}>N{current.level}</Text>
        </View>
        <View style={styles.compactBarWrap}>
          <Animated.View
            style={[
              styles.fill,
              {
                width:           widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                backgroundColor: current.color,
              },
            ]}
          />
        </View>
        <Text style={styles.xpLabel}>{xp} XP</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          {/* v1.1 : séparateur ASCII */}
          <Text style={styles.levelLabel}>{t('dashboard.level_label')} {current.level} - {current.label}</Text>
          <Text style={styles.xpValue}>{xp} {t('dashboard.xp_label')}</Text>
        </View>
        {next && (
          <Text style={styles.nextLabel}>{next.minXP - xp} XP {">"} N{next.level}</Text>
        )}
      </View>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              width:           widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
              backgroundColor: current.color,
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.sm,
  },
  headerRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'flex-end',
  },
  levelLabel: {
    fontSize:   Typography.caption,
    fontWeight: Typography.semibold,
    color:      Colors.ink60,
    marginBottom: 2,
  },
  xpValue: {
    fontSize:   Typography.h3,
    fontWeight: Typography.bold,
    color:      Colors.ink,
  },
  nextLabel: {
    fontSize:   Typography.caption,
    color:      Colors.ink60,
  },
  track: {
    height:           8,
    backgroundColor:  Colors.border,
    borderRadius:     Radius.full,
    overflow:         'hidden',
  },
  fill: {
    height:       8,
    borderRadius: Radius.full,
  },
  // Compact
  compactRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           8,
  },
  levelBadge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      Radius.sm,
  },
  levelText: {
    fontSize:   Typography.tiny,
    fontWeight: Typography.bold,
  },
  compactBarWrap: {
    flex:             1,
    height:           6,
    backgroundColor:  Colors.border,
    borderRadius:     Radius.full,
    overflow:         'hidden',
  },
  xpLabel: {
    fontSize:   Typography.caption,
    fontWeight: Typography.medium,
    color:      Colors.ink60,
    minWidth:   50,
    textAlign:  'right',
  },
});
