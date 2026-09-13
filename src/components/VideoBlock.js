// src/components/VideoBlock.js
// Bloc vidéo de section de leçon + transcription repliable.
//
// Exigence : « préparer les contenus vidéo » — les modules peuvent embarquer
// une vidéo par section :
//   section.video = { url, duration_sec, transcript?, thumbnail? }
//   (ou format legacy plat : section.videoUrl + section.transcript/duration_sec)
//
// Accessibilité auditifs : la transcription est REPLIABLE sous la vidéo, avec
// la note « Pour les apprenants sourds et malentendants » (le contenu textuel
// reste accessible sans le son).
//
// Robustesse : require expo-av PROTÉGÉ (même pattern que ImagePicker dans
// EditProfileScreen) — sans le module natif, on affiche une carte de
// repli au lieu de crasher. Sans url → le bloc ne rend rien.

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

import { Colors, Typography, Spacing, Radius } from '../theme';
import { FONT_CAPS, scaledLineHeight } from '../theme/fontCaps';

// Import dynamique protégé — un module natif manquant ne crashe pas l'app.
let Video = null;
try { ({ Video } = require('expo-av')); } catch (_) {}

/** Formate une durée en secondes → « 2 min 10 s » (null si absente/nulle). */
export function formatDuration(totalSec) {
  const s = Math.round(Number(totalSec) || 0);
  if (!s || s < 0) return null;
  const min = Math.floor(s / 60);
  const sec = s % 60;
  if (min === 0) return `${sec} s`;
  if (sec === 0) return `${min} min`;
  return `${min} min ${sec} s`;
}

export default function VideoBlock({ url, durationSec, transcript, thumbnail, onPlaybackStatusUpdate }) {
  const [showTranscript, setShowTranscript] = useState(false);

  // No-op par défaut — CRÉÉ AVANT le retour anticipé null (règles des hooks :
  // aucun hook conditionnel, l'ordre d'appel doit rester stable).
  const handlePlaybackStatusUpdate = useCallback((status) => {
    if (onPlaybackStatusUpdate) onPlaybackStatusUpdate(status);
  }, [onPlaybackStatusUpdate]);

  // Sans URL, le bloc ne rend rien (sections purement texte).
  if (!url) return null;

  const durationLabel = formatDuration(durationSec);

  return (
    <View style={styles.wrap}>
      {/* Lecteur */}
      {Video ? (
        <Video
          source={{ uri: url }}
          style={styles.video}
          resizeMode="contain"
          useNativeControls
          usePoster={!!thumbnail}
          posterSource={thumbnail ? { uri: thumbnail } : undefined}
          onPlaybackStatusUpdate={handlePlaybackStatusUpdate}
        />
      ) : (
        // Repli sans expo-av (module natif absent) — la transcription reste
        // disponible : le contenu n'est jamais perdu.
        <View style={[styles.video, styles.videoFallback]}>
          <Text style={styles.videoFallbackIcon} maxFontSizeMultiplier={FONT_CAPS.tight}>🎬</Text>
          <Text
            style={styles.videoFallbackText}
            numberOfLines={2}
            maxFontSizeMultiplier={FONT_CAPS.tight}
          >
            Vidéo — lecture indisponible sur cet appareil
          </Text>
        </View>
      )}

      {/* Durée */}
      {durationLabel && (
        <Text style={styles.durationText} numberOfLines={1} maxFontSizeMultiplier={FONT_CAPS.tight}>
          ⏱ {durationLabel}
        </Text>
      )}

      {/* Transcription repliable — apprenants sourds et malentendants */}
      {transcript ? (
        <View style={styles.transcriptBox}>
          <TouchableOpacity
            style={styles.transcriptToggle}
            onPress={() => setShowTranscript(v => !v)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Afficher ou masquer la transcription"
            accessibilityState={{ expanded: showTranscript }}
          >
            <Text
              style={styles.transcriptToggleText}
              numberOfLines={1}
              maxFontSizeMultiplier={FONT_CAPS.tight}
            >
              {showTranscript ? '▼' : '▶'} Transcription
            </Text>
            <Text
              style={styles.transcriptNote}
              numberOfLines={2}
              maxFontSizeMultiplier={FONT_CAPS.tight}
            >
              Pour les apprenants sourds et malentendants
            </Text>
          </TouchableOpacity>
          {showTranscript && (
            <Text style={styles.transcriptText} maxFontSizeMultiplier={FONT_CAPS.reading}>
              {transcript}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.sm,
    gap: Spacing.xs,
  },
  video: {
    height: 200,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.ink,
  },
  videoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.ink10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  videoFallbackIcon: {
    fontSize: 28,
  },
  videoFallbackText: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    textAlign: 'center',
    paddingHorizontal: Spacing.md,
  },
  durationText: {
    fontSize: Typography.caption,
    color: Colors.ink60,
    alignSelf: 'flex-start',
  },
  transcriptBox: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceAlt,
    overflow: 'hidden',
  },
  transcriptToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    minHeight: 44,                                   // cible tactile confortable
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  transcriptToggleText: {
    fontSize: Typography.caption,
    fontWeight: Typography.bold,
    color: Colors.primary,
    flexShrink: 0,
  },
  transcriptNote: {
    fontSize: Typography.tiny,
    color: Colors.ink60,
    fontStyle: 'italic',
    textAlign: 'right',
    flexShrink: 1,
  },
  transcriptText: {
    fontSize: Typography.body,
    color: Colors.ink,
    lineHeight: scaledLineHeight(22),
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
});
