// src/screens/BadgeWalletScreen.js
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Modal, StatusBar, RefreshControl, Share, Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { Colors, Typography, Spacing, Radius, Shadow } from '../theme';
import { useDb }         from '../database/DbProvider';
import { getBadgeTier, formatHash } from '../blockchain/badgeGenerator';
import { t }             from '../i18n';

const { width: SCREEN_W } = Dimensions.get('window');
const QR_SIZE = Math.min(SCREEN_W - 96, 220);

export default function BadgeWalletScreen() {
  const insets = useSafeAreaInsets();
  const { learner, getAllBadges } = useDb();

  const [badges, setBadges]           = useState([]);
  const [selected, setSelected]       = useState(null);   // badge modal
  const [refreshing, setRefreshing]   = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const load = useCallback(async () => {
    const all = await getAllBadges();
    setBadges(all);
    setPendingCount(all.filter(b => b.sync_status === 'pending').length);
  }, [getAllBadges]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleShare = async (badge) => {
    const parsed  = safeParseQR(badge.qr_payload);
    const url     = parsed?.verify_url ?? `https://verify.edukraft.tg/badge/${badge.id}`;
    const score   = Math.round(badge.score * 100);
    const tier    = getBadgeTier(badge.score);

    await Share.share({
      message:
        `🎓 J'ai obtenu mon badge EduKraft ${tier.emoji}\n` +
        `Module : ${badge.module_title}\n` +
        `Score : ${score}% · ${badge.xp_total} XP\n\n` +
        `Vérifier mon badge (certifié blockchain) :\n${url}`,
      title: `Badge EduKraft — ${badge.module_title}`,
    });
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.surfaceAlt} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View>
          <Text style={styles.headerTitle}>{t('badge.title')}</Text>
          <Text style={styles.headerSub}>{t('badge.subtitle')}</Text>
        </View>
        {pendingCount > 0 && (
          <View style={styles.syncBadge}>
            <View style={styles.syncDot} />
            <Text style={styles.syncText}>{pendingCount} en attente</Text>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Stats strip */}
        {badges.length > 0 && (
          <View style={styles.statsStrip}>
            <StatMini value={badges.length} label="Badges obtenus" />
            <View style={styles.statsDivider} />
            <StatMini
              value={`${Math.round((badges.reduce((s, b) => s + b.score, 0) / badges.length) * 100)}%`}
              label="Score moyen"
            />
            <View style={styles.statsDivider} />
            <StatMini
              value={badges.reduce((s, b) => s + b.xp_total, 0)}
              label="XP total"
            />
          </View>
        )}

        {/* Empty state */}
        {badges.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🏅</Text>
            <Text style={styles.emptyTitle}>{t('badge.empty_title')}</Text>
            <Text style={styles.emptyText}>{t('badge.empty_text')}</Text>
          </View>
        )}

        {/* Badge list */}
        {badges.map((badge) => (
          <BadgeListItem
            key={badge.id}
            badge={badge}
            onPress={() => setSelected(badge)}
            onShare={() => handleShare(badge)}
          />
        ))}

        {/* Info blockchain */}
        {badges.length > 0 && (
          <View style={styles.chainInfo}>
            <Text style={styles.chainInfoIcon}>⛓</Text>
            <Text style={styles.chainInfoText}>
              Chaque badge est ancré sur la {'\n'}
              <Text style={{ fontWeight: Typography.bold, color: Colors.primary }}>blockchain Polygon PoS</Text>
              {' '}— inviolable et vérifiable par n'importe qui, partout dans le monde.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Modal détail badge ──────────────────────────────── */}
      <Modal
        visible={!!selected}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSelected(null)}
      >
        {selected && (
          <BadgeDetail
            badge={selected}
            insets={insets}
            onClose={() => setSelected(null)}
            onShare={() => handleShare(selected)}
          />
        )}
      </Modal>
    </View>
  );
}

// ── BadgeListItem ──────────────────────────────────────────────────────────────
function BadgeListItem({ badge, onPress, onShare }) {
  const tier      = getBadgeTier(badge.score);
  const isPending = badge.sync_status === 'pending';
  const score     = Math.round(badge.score * 100);

  return (
    <TouchableOpacity
      style={[styles.listItem, Shadow.card]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      {/* Tier icon */}
      <View style={[styles.tierCircle, { backgroundColor: tier.color + '22' }]}>
        <Text style={styles.tierEmoji}>{tier.emoji}</Text>
      </View>

      {/* Info */}
      <View style={styles.listInfo}>
        <Text style={styles.listTitle} numberOfLines={1}>{badge.module_title}</Text>
        <Text style={styles.listMeta}>
          {formatDate(badge.issued_at)} · {badge.xp_total} XP
        </Text>
        <View style={styles.listBottom}>
          <View style={[styles.scorePill, { backgroundColor: tier.color + '22' }]}>
            <Text style={[styles.scorePillText, { color: tier.color }]}>{score}%</Text>
          </View>
          <View style={[styles.chainPill, { backgroundColor: isPending ? Colors.amberLight : Colors.tealLight }]}>
            <View style={[styles.chainDot, { backgroundColor: isPending ? Colors.amber : Colors.teal }]} />
            <Text style={[styles.chainPillText, { color: isPending ? Colors.amber : Colors.teal }]}>
              {isPending ? 'Sync en attente' : 'Certifié Polygon'}
            </Text>
          </View>
        </View>
      </View>

      {/* Share */}
      <TouchableOpacity onPress={onShare} style={styles.shareBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.shareIcon}>↗</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

// ── BadgeDetail (modal) ────────────────────────────────────────────────────────
function BadgeDetail({ badge, insets, onClose, onShare }) {
  const tier   = getBadgeTier(badge.score);
  const score  = Math.round(badge.score * 100);
  const parsed = safeParseQR(badge.qr_payload);
  const isPending = badge.sync_status === 'pending';

  return (
    <View style={[detailStyles.root, { paddingTop: insets.top + 20 }]}>
      <ScrollView
        contentContainerStyle={[detailStyles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Close */}
        <TouchableOpacity onPress={onClose} style={detailStyles.closeBtn}>
          <Text style={detailStyles.closeText}>✕</Text>
        </TouchableOpacity>

        {/* Badge header */}
        <View style={[detailStyles.badgeHeader, { backgroundColor: tier.color + '15' }]}>
          <Text style={detailStyles.headerEmoji}>{tier.emoji}</Text>
          <Text style={detailStyles.headerTier}>{tier.label}</Text>
          <Text style={detailStyles.headerTitle}>{badge.module_title}</Text>
          <View style={detailStyles.scoreRow}>
            <Text style={[detailStyles.scoreVal, { color: tier.color }]}>{score}%</Text>
            <Text style={detailStyles.scoreSep}>·</Text>
            <Text style={detailStyles.xpVal}>{badge.xp_total} XP</Text>
          </View>
        </View>

        {/* QR Code section */}
        <View style={detailStyles.qrSection}>
          <Text style={detailStyles.qrLabel}>{t('badge.verify_qr')}</Text>
          <View style={[detailStyles.qrCard, Shadow.card]}>
            <QRCode
              value={badge.qr_payload || `https://verify.edukraft.tg/badge/${badge.id}`}
              size={QR_SIZE}
              color={Colors.primaryDark}
              backgroundColor="transparent"
              ecl="M"
            />
          </View>
          <Text style={detailStyles.qrHint}>
            Scanner avec n'importe quel téléphone{'\n'}pour vérifier l'authenticité
          </Text>
        </View>

        {/* Metadata */}
        <View style={detailStyles.metaCard}>
          <MetaRow label={t('badge.earned_on')}  value={formatDateLong(badge.issued_at)} />
          <MetaRow label={t('badge.score_label')} value={`${score} / 100`} />
          <MetaRow label="XP obtenus"             value={`${badge.xp_total} points`} />
          <MetaRow label={t('badge.hash_label')}  value={formatHash(badge.badge_hash)} mono />
          <MetaRow
            label="Réseau"
            value={isPending ? 'Polygon PoS (sync en attente)' : `Polygon PoS · tx: ${formatHash(badge.blockchain_tx ?? '—', 6)}`}
            color={isPending ? Colors.amber : Colors.teal}
          />
        </View>

        {/* Blockchain explanation */}
        <View style={detailStyles.explainBox}>
          <Text style={detailStyles.explainTitle}>🔒 {t('badge.blockchain_info')}</Text>
          <Text style={detailStyles.explainText}>
            Un identifiant unique (hash SHA-256) de ce badge est inscrit de façon permanente et immuable sur la blockchain Polygon PoS.
            {'\n\n'}
            Personne — ni EduKraft, ni aucune tierce partie — ne peut modifier ou falsifier ce badge. Il t'appartient pour toujours.
          </Text>
        </View>

        {/* Share button */}
        <TouchableOpacity
          style={[detailStyles.shareFullBtn, Shadow.button]}
          onPress={onShare}
          activeOpacity={0.85}
        >
          <Text style={detailStyles.shareFullText}>↗ {t('badge.share')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function MetaRow({ label, value, mono, color }) {
  return (
    <View style={detailStyles.metaRow}>
      <Text style={detailStyles.metaLabel}>{label}</Text>
      <Text style={[detailStyles.metaValue, mono && detailStyles.metaMono, color && { color }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function StatMini({ value, label }) {
  return (
    <View style={styles.statMini}>
      <Text style={styles.statMiniVal}>{value}</Text>
      <Text style={styles.statMiniLbl}>{label}</Text>
    </View>
  );
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-TG', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDateLong(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-TG', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}
function safeParseQR(payload) {
  try { return JSON.parse(payload); } catch { return {}; }
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root:         { flex: 1, backgroundColor: Colors.surfaceAlt },
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom:     Spacing.md,
    backgroundColor:   Colors.surfaceAlt,
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
  },
  headerTitle: { fontSize: Typography.h1, fontWeight: Typography.bold, color: Colors.ink },
  headerSub:   { fontSize: Typography.caption, color: Colors.ink60, marginTop: 2 },
  syncBadge: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    backgroundColor:   Colors.amberLight,
    paddingHorizontal: Spacing.sm,
    paddingVertical:   4,
    borderRadius:      Radius.full,
  },
  syncDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.amber },
  syncText: { fontSize: Typography.tiny, fontWeight: Typography.semibold, color: Colors.amber },
  scroll:   { flex: 1 },
  content:  { padding: Spacing.lg, gap: Spacing.md },

  statsStrip: {
    flexDirection:   'row',
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    alignItems:      'center',
    ...Shadow.card,
  },
  statMini:     { flex: 1, alignItems: 'center', gap: 2 },
  statMiniVal:  { fontSize: Typography.h2, fontWeight: Typography.bold, color: Colors.primary },
  statMiniLbl:  { fontSize: Typography.tiny, color: Colors.ink60, textAlign: 'center' },
  statsDivider: { width: 1, height: 32, backgroundColor: Colors.border },

  emptyState:  { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.md },
  emptyIcon:   { fontSize: 56 },
  emptyTitle:  { fontSize: Typography.h2, fontWeight: Typography.bold, color: Colors.ink },
  emptyText:   { fontSize: Typography.body, color: Colors.ink60, textAlign: 'center', lineHeight: 22 },

  listItem: {
    flexDirection:   'row',
    alignItems:      'center',
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  tierCircle: {
    width:          52,
    height:         52,
    borderRadius:   26,
    alignItems:     'center',
    justifyContent: 'center',
    flexShrink:     0,
  },
  tierEmoji: { fontSize: 24 },
  listInfo:  { flex: 1, gap: 3 },
  listTitle: { fontSize: Typography.body, fontWeight: Typography.bold, color: Colors.ink },
  listMeta:  { fontSize: Typography.caption, color: Colors.ink60 },
  listBottom: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap', marginTop: 2 },
  scorePill: {
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      Radius.full,
  },
  scorePillText: { fontSize: Typography.tiny, fontWeight: Typography.bold },
  chainPill: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               3,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      Radius.full,
  },
  chainDot:      { width: 5, height: 5, borderRadius: 3 },
  chainPillText: { fontSize: Typography.tiny, fontWeight: Typography.medium },
  shareBtn:      { padding: Spacing.xs },
  shareIcon:     { fontSize: 18, color: Colors.ink30 },

  chainInfo: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    gap:            Spacing.sm,
    backgroundColor: Colors.primaryLight,
    borderRadius:   Radius.md,
    padding:        Spacing.md,
    marginTop:      Spacing.sm,
  },
  chainInfoIcon: { fontSize: 18 },
  chainInfoText: { flex: 1, fontSize: Typography.caption, color: Colors.ink60, lineHeight: 18 },
});

const detailStyles = StyleSheet.create({
  root:    { flex: 1, backgroundColor: Colors.surface },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  closeBtn: {
    alignSelf:       'flex-end',
    padding:         Spacing.sm,
    marginBottom:    -Spacing.sm,
  },
  closeText: { fontSize: 18, color: Colors.ink60 },
  badgeHeader: {
    borderRadius: Radius.xl,
    padding:      Spacing.xl,
    alignItems:   'center',
    gap:          Spacing.xs,
  },
  headerEmoji: { fontSize: 48 },
  headerTier:  { fontSize: Typography.caption, fontWeight: Typography.bold, color: Colors.ink60, textTransform: 'uppercase', letterSpacing: 1 },
  headerTitle: { fontSize: Typography.h1, fontWeight: Typography.bold, color: Colors.ink, textAlign: 'center' },
  scoreRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
  scoreVal:    { fontSize: Typography.h1, fontWeight: Typography.bold },
  scoreSep:    { fontSize: Typography.h2, color: Colors.ink30 },
  xpVal:       { fontSize: Typography.h3, fontWeight: Typography.medium, color: Colors.ink60 },
  qrSection:   { alignItems: 'center', gap: Spacing.sm },
  qrLabel:     { fontSize: Typography.caption, fontWeight: Typography.semibold, color: Colors.ink60, textTransform: 'uppercase', letterSpacing: 0.5 },
  qrCard: {
    backgroundColor: Colors.surface,
    borderRadius:    Radius.lg,
    padding:         Spacing.lg,
    borderWidth:     1,
    borderColor:     Colors.border,
  },
  qrHint:  { fontSize: Typography.caption, color: Colors.ink30, textAlign: 'center', lineHeight: 18 },
  metaCard: {
    backgroundColor: Colors.surfaceAlt,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  metaRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaLabel:  { fontSize: Typography.caption, color: Colors.ink60, flex: 1 },
  metaValue:  { fontSize: Typography.caption, fontWeight: Typography.semibold, color: Colors.ink, flex: 1.8, textAlign: 'right' },
  metaMono:   { fontFamily: 'monospace', color: Colors.primary, fontSize: Typography.tiny },
  explainBox: {
    backgroundColor: Colors.primaryLight,
    borderRadius:    Radius.lg,
    padding:         Spacing.md,
    gap:             Spacing.sm,
  },
  explainTitle: { fontSize: Typography.body, fontWeight: Typography.bold, color: Colors.primaryDark },
  explainText:  { fontSize: Typography.caption, color: Colors.ink60, lineHeight: 20 },
  shareFullBtn: {
    backgroundColor:  Colors.primary,
    borderRadius:     Radius.xl,
    paddingVertical:  Spacing.md,
    alignItems:       'center',
  },
  shareFullText: { fontSize: Typography.bodyLg, fontWeight: Typography.bold, color: Colors.surface },
});
