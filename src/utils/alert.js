// src/utils/alert.js
// Alerte multi-plateforme — correctif v1.1.16 du bug « déconnexion impossible
// sur le web ».
//
// PROBLÈME : react-native-web n'implémente PAS Alert.alert (no-op silencieux).
// ProfileScreen.handleLogout reposait sur Alert.alert(...) pour confirmer la
// déconnexion → sur web, appuyer sur « Se déconnecter » ne faisait STRICTEMENT
// RIEN (aucun dialogue, aucune action). Même chose pour « Réinitialiser »,
// les alertes d'erreur de LoginScreen, la confirmation de sauvegarde du
// EditProfile, etc.
//
// SOLUTION : alertUser() utilise window.confirm/window.alert sur web (avec le
// bouton PRINCIPAL comme libellé d'action) et Alert.alert sur natif. L'API est
// identique à Alert.alert(title, message, buttons) — remplacement direct.

import { Alert, Platform } from 'react-native';

/**
 * Affiche une alerte / un dialogue de confirmation sur TOUTES les plateformes.
 * @param {string} title
 * @param {string} [message]
 * @param {Array<{text: string, style?: 'cancel'|'destructive'|'default', onPress?: Function}>} [buttons]
 *   - natif : passé tel quel à Alert.alert.
 *   - web   : le bouton « principal » (destructif > premier actionnable) sert
 *             de libellé de confirmation window.confirm ; le bouton style
 *             'cancel' est invoqué si l'utilisateur refuse.
 */
export function alertUser(title, message, buttons) {
  const btns = Array.isArray(buttons) ? buttons.filter(Boolean) : [];

  // ── Natif : comportement d'origine ──
  if (Platform.OS !== 'web') {
    Alert.alert(title, message, btns.length ? btns : undefined);
    return;
  }

  // ── Web ──
  if (typeof window === 'undefined' || !window.confirm) return;

  // Simple information (aucun bouton actionnable) → alert()
  const actionable = btns.filter(b => typeof b.onPress === 'function');
  if (!btns.length || !actionable.length) {
    window.alert(`${title ? title + '\n\n' : ''}${message || ''}`);
    return;
  }

  // Dialogue de décision → confirm() avec le bouton principal
  const cancelBtn = btns.find(b => b.style === 'cancel') || null;
  const mainBtn =
    btns.find(b => b.style === 'destructive' && typeof b.onPress === 'function')
    || btns.find(b => b !== cancelBtn && typeof b.onPress === 'function')
    || btns[btns.length - 1];

  const lines = [title, message].filter(v => v && String(v).trim() !== '');
  const prompt = `${lines.join('\n\n')}\n\n[${mainBtn?.text || 'OK'} ?]`;
  const ok = window.confirm(prompt);
  if (ok) {
    try { mainBtn?.onPress?.(); } catch (e) { console.warn('[alert] onPress error:', e?.message); }
  } else {
    try { cancelBtn?.onPress?.(); } catch (e) { /* annulation */ }
  }
}

export default alertUser;
