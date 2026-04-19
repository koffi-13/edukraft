// src/components/BadgeCard.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { getBadgeTier, formatHash } from '../blockchain/badgeGenerator';
import { t } from '../i18n';

export default function BadgeCard({ badge, onPress, compact = false }) {
  const parsed   = safeParseQR(badge.qr_payload);
  const tier     = getBadgeTier(badge.score);
  const isPending = badge.sync_status === 'pending';

  if (compact) {
    return (
      <TouchableOpacity style={[styles.compactCard, Shadow.card]} onPress={onPress} activeOpacity={0.85}>
        <View style={[styles.tierBadge, { backgroundColor: tier.color + '22' }]}>
          <Text style={styles.tierEmoji}>{tier.emoji}</Text>
        </View>
        <View style={styles.compactInfo}>
          <Text style={styles.compactTitle} numberOfLines={1}>{badge.module_title}</Text>
          <Text style={styles.compactMeta}>
            {Math.round(badge.score * 100)}% · {badge.xp_total} XP
          </Text>
        </View>
        <View style={[styles.statusDot, { backgroundColor: isPending ? Colors.amber : Colors.teal }]} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity style={[styles.card, Shadow.card]} onPress={onPress} activeOpacity={0.9}>
      {/* Header */}
      <View style={[styles.cardHeader, { backgroundColor: Colors.primaryLight }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.moduleTitle}>{badge.module_title}</Text>
          <View style={[styles.tierPill, { backgroundColor: tier.color + '22' }]}>
            <Text style={[styles.tierLabel, { color: tier.color }]}>
              {tier.emoji} {tier.label}
            </Text>
          </View>
        </View>
        <View style={styles.scoreCircle}>
          <Text style={styles.scoreNumber}>{Math.round(badge.score * 100)}</Text>
          <Text style={styles.scorePercent}>%</Text>
        </View>
      </View>

      {/* Body */}
      <View style={styles.cardBody}>
        {/* QR Code */}
        <View style={styles.qrSection}>
          <QRCode
            value={badge.qr_payload || 'https://verify.edukraft.tg'}
            size={100}
            color={Colors.primaryDark}
            backgroundColor="transparent"
          />
          <Text style={styles.qrHint}>{t('badge.verify_qr')}</Text>
        </View>

        {/* Détails */}
        <View style={styles.detailsSection}>
          <DetailRow label={t('badge.earned_on')} value={formatDate(badge.issued_at)} />
          <DetailRow label={t('badge.score_label')} value={`${Math.round(badge.score * 100)}%`} />
          <DetailRow label="XP" value={`${badge.xp_total} points`} />
          <DetailRow
            label={t('badge.hash_label')}
            value={formatHash(badge.badge_hash)}
            mono
          />
        </View>
      </View>

      {/* Blockchain status */}
      <View style={[styles.chainBanner, { backgroundColor: isPending ? Colors.amberLight : Colors.tealLight }]}>
        <View style={[styles.statusDot, { backgroundColor: isPending ? Colors.amber : Colors.teal }]} />
        <Text style={[styles.chainText, { color: isPending ? Colors.amber : Colors.teal }]}>
          {isPending ? t('badge.pending_sync') : t('badge.synced')} · Polygon PoS
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('fr-TG', { day: '2-digit', month: 'short', year: 'numeric' });
}

function safeParseQR(payload) {
  try { return JSON.parse(payload); } catch { return {}; }
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    overflow:        'hidden',
    marginBottom:    Spacing.md,
  },
  cardHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        Spacing.md,
  },
  headerLeft: {
    flex: 1,
    gap:  Spacing.xs,
  },
  moduleTitle: {
    fontSize:   Typography.h3,
    fontWeight: Typography.bold,
    color:      Colors.primaryDark,
  },
  tierPill: {
    alignSelf:        'flex-start',
    paddingHorizontal: 10,
    paddingVertical:   3,
    borderRadius:      Radius.full,
  },
  tierLabel: {
    fontSize:   Typography.caption,
    fontWeight: Typography.semibold,
  },
  scoreCircle: {
    width:           56,
    height:          56,
    borderRadius:    28,
    backgroundColor: Colors.primary,
    alignItems:      'center',
    justifyContent:  'center',
    flexDirection:   'row',
    alignItems:      'baseline',
  },
  scoreNumber: {
    fontSize:   Typography.h2,
    fontWeight: Typography.bold,
    color:      Colors.surface,
  },
  scorePercent: {
    fontSize:   Typography.caption,
    color:      Colors.surface + 'CC',
  },
  cardBody: {
    flexDirection: 'row',
    padding:       Spacing.md,
    gap:           Spacing.md,
  },
  qrSection: {
    alignItems: 'center',
    gap:        Spacing.xs,
  },
  qrHint: {
    fontSize:  Typography.tiny,
    color:     Colors.ink60,
    textAlign: 'center',
    width:     100,
  },
  detailsSection: {
    flex: 1,
    gap:  Spacing.xs,
  },
  detailRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  detailLabel: {
    fontSize: Typography.caption,
    color:    Colors.ink60,
    flex:     1,
  },
  detailValue: {
    fontSize:   Typography.caption,
    fontWeight: Typography.medium,
    color:      Colors.ink,
    flex:       1.5,
    textAlign:  'right',
  },
  mono: {
    fontFamily: 'monospace',
    fontSize:   Typography.tiny,
    color:      Colors.primary,
  },
  chainBanner: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical:   Spacing.xs,
  },
  statusDot: {
    width:        6,
    height:       6,
    borderRadius: 3,
  },
  chainText: {
    fontSize:   Typography.tiny,
    fontWeight: Typography.medium,
  },
  // Compact
  compactCard: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    borderRadius:    Radius.md,
    padding:         Spacing.sm,
    gap:             Spacing.sm,
    marginBottom:    Spacing.sm,
  },
  tierBadge: {
    width:          40,
    height:         40,
    borderRadius:   20,
    alignItems:     'center',
    justifyContent: 'center',
  },
  tierEmoji: { fontSize: 20 },
  compactInfo: { flex: 1 },
  compactTitle: {
    fontSize:   Typography.body,
    fontWeight: Typography.semibold,
    color:      Colors.ink,
  },
  compactMeta: {
    fontSize: Typography.caption,
    color:    Colors.ink60,
    marginTop: 2,
  },
});
