// src/theme/index.js
// Design tokens EduKraft — optimisé Android 1 Go RAM
// Palette : violet ancré, vert-teal, ambre chaud

export const Colors = {
  // Brand primaires
  primary:       '#5B4ABB',
  primaryLight:  '#EEEDFE',
  primaryDark:   '#3C3489',

  // Accent
  teal:          '#1D9E75',
  tealLight:     '#E1F5EE',
  tealDark:      '#085041',

  amber:         '#BA7517',
  amberLight:    '#FAEEDA',

  coral:         '#D85A30',
  coralLight:    '#FAECE7',

  // Neutrals
  ink:           '#1A1A2E',
  ink60:         '#5F5E6E',
  ink30:         '#B4B3C4',
  ink10:         '#F1F0FA',
  surface:       '#FFFFFF',
  surfaceAlt:    '#F7F6FD',
  border:        '#E2E1F0',

  // Statuts
  success:       '#1D9E75',
  warning:       '#BA7517',
  error:         '#D85A30',

  // XP / Gamification
  xpGold:        '#F0B429',
  xpSilver:      '#9CA3AF',
  xpBronze:      '#CD7C3A',
  
  // Alias pour compatibilité avec le dashboard
  background:    '#F8F9FB', // Corrected typo here
  ink50:         '#718096',
};

export const Typography = {
  // Tailles en points — multiplier par 1 pour sp React Native
  display:  28,
  h1:       22,
  h2:       18,
  h3:       16,
  body:     14,
  bodyLg:   15,
  caption:  12,
  tiny:     11,

  // Poids
  regular:  '400',
  medium:   '500',
  semibold: '600',
  bold:     '700',
};

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
};

export const Radius = {
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,
  full: 999,
};

export const Shadow = {
  card: {
    shadowColor: '#5B4ABB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,          // Android elevation — léger pour performances
  },
  button: {
    shadowColor: '#5B4ABB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 5,
  },
};

// XP thresholds par niveau
export const XP_LEVELS = [
  { level: 1, label: 'Débutant',      minXP: 0,    color: Colors.xpBronze },
  { level: 2, label: 'Apprenti',      minXP: 100,  color: Colors.xpBronze },
  { level: 3, label: 'Confirmé',      minXP: 250,  color: Colors.xpSilver },
  { level: 4, label: 'Avancé',        minXP: 500,  color: Colors.xpSilver },
  { level: 5, label: 'Expert',        minXP: 900,  color: Colors.xpGold   },
  { level: 6, label: 'Maître',        minXP: 1400, color: Colors.xpGold   },
];

export function getLevel(xp) {
  let current = XP_LEVELS[0];
  let next = XP_LEVELS[1];
  for (let i = XP_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= XP_LEVELS[i].minXP) {
      current = XP_LEVELS[i];
      next = XP_LEVELS[i + 1] || null;
      break;
    }
  }
  const progress = next
    ? (xp - current.minXP) / (next.minXP - current.minXP)
    : 1;
  return { current, next, progress };
}