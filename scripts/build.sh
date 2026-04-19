#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# EduKraft MVP — Script de build APK pour démonstration
# Usage : chmod +x scripts/build.sh && ./scripts/build.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
AMBER='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

echo -e "${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║     EduKraft MVP — Build APK Android         ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""

# ── PRE-FLIGHT CHECKS ────────────────────────────────────────────────────────

echo -e "${BOLD}[1/5] Vérification de l'environnement...${RESET}"

# Node.js
if ! command -v node &>/dev/null; then
  echo -e "${RED}✗ Node.js non trouvé. Installer depuis https://nodejs.org${RESET}"; exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.version)")
echo -e "  ${GREEN}✓ Node.js${RESET} $NODE_VER"

# npm
if ! command -v npm &>/dev/null; then
  echo -e "${RED}✗ npm non trouvé.${RESET}"; exit 1
fi
echo -e "  ${GREEN}✓ npm${RESET} $(npm -v)"

# Expo CLI
if ! command -v expo &>/dev/null && ! npx expo --version &>/dev/null 2>&1; then
  echo -e "${AMBER}  ! Expo CLI non trouvé globalement — utilisation de npx${RESET}"
  EXPO_CMD="npx expo"
else
  EXPO_CMD="expo"
  echo -e "  ${GREEN}✓ Expo CLI${RESET} $($EXPO_CMD --version 2>/dev/null || echo 'version inconnue')"
fi

# EAS CLI (pour build cloud)
if command -v eas &>/dev/null; then
  echo -e "  ${GREEN}✓ EAS CLI${RESET} $(eas --version 2>/dev/null | head -1)"
  HAS_EAS=true
else
  echo -e "  ${AMBER}  ! EAS CLI non trouvé — build local uniquement${RESET}"
  HAS_EAS=false
fi

echo ""
echo -e "${BOLD}[2/5] Installation des dépendances...${RESET}"
npm install --silent
echo -e "  ${GREEN}✓ node_modules installé${RESET}"

echo ""
echo -e "${BOLD}[3/5] Validation des modules JSON...${RESET}"
node -e "
const fs   = require('fs');
const mods = [
  'src/content/modules/marketing_digital_local.json',
  'src/content/modules/comptabilite_artisanale.json',
];
let ok = 0;
mods.forEach(f => {
  try {
    const m = JSON.parse(fs.readFileSync(f, 'utf8'));
    const lessons   = m.lessons.length;
    const questions = m.lessons.reduce((s,l)=>s+l.quiz.questions.length,0);
    console.log('  ✓', m.id, '—', lessons, 'leçons,', questions, 'questions');
    ok++;
  } catch(e) { console.error('  ✗', f, ':', e.message); process.exit(1); }
});
console.log('  ' + ok + '/' + mods.length + ' modules valides');
"

echo ""
echo -e "${BOLD}[4/5] Sélection du type de build...${RESET}"
echo ""
echo "  1) APK debug local  (rapide, ~5 min, ne nécessite pas de compte Expo)"
echo "  2) APK preview EAS  (cloud Expo, ~15 min, compte expo.dev requis)"
echo "  3) QR Code Expo Go  (le plus rapide — test immédiat sur téléphone)"
echo ""
read -p "  Choix [1/2/3, défaut=1] : " BUILD_CHOICE
BUILD_CHOICE=${BUILD_CHOICE:-1}

echo ""
echo -e "${BOLD}[5/5] Lancement du build...${RESET}"
echo ""

case "$BUILD_CHOICE" in
  1)
    echo -e "  ${AMBER}→ Build APK local avec Expo prebuild + Gradle${RESET}"
    echo "  Prérequis : Android Studio installé, variable ANDROID_HOME définie"
    echo ""

    # Vérifier Android SDK
    if [ -z "${ANDROID_HOME:-}" ]; then
      echo -e "  ${RED}✗ ANDROID_HOME non défini.${RESET}"
      echo "  Définir ANDROID_HOME dans ~/.bashrc ou ~/.zshrc :"
      echo "    export ANDROID_HOME=\$HOME/Android/Sdk"
      echo "    export PATH=\$PATH:\$ANDROID_HOME/tools:\$ANDROID_HOME/platform-tools"
      echo ""
      echo "  Alternative rapide : utiliser l'option 3 (QR Code) sur téléphone Android."
      exit 1
    fi

    $EXPO_CMD prebuild --platform android --clean
    cd android
    ./gradlew assembleDebug
    cd ..

    APK_PATH="android/app/build/outputs/apk/debug/app-debug.apk"
    if [ -f "$APK_PATH" ]; then
      SIZE=$(du -h "$APK_PATH" | cut -f1)
      echo ""
      echo -e "${GREEN}╔══════════════════════════════════════════╗${RESET}"
      echo -e "${GREEN}║  ✅  BUILD RÉUSSI                        ║${RESET}"
      echo -e "${GREEN}║  APK : $APK_PATH${RESET}"
      echo -e "${GREEN}║  Taille : $SIZE                         ║${RESET}"
      echo -e "${GREEN}╚══════════════════════════════════════════╝${RESET}"
      echo ""
      echo "  Installer sur téléphone connecté en USB :"
      echo "    adb install $APK_PATH"
    else
      echo -e "${RED}✗ APK non trouvé après le build.${RESET}"
      exit 1
    fi
    ;;

  2)
    if [ "$HAS_EAS" = false ]; then
      echo -e "  ${AMBER}Installation de EAS CLI...${RESET}"
      npm install -g eas-cli
    fi

    echo -e "  ${AMBER}→ Build APK cloud via EAS (expo.dev)${RESET}"
    echo "  Connexion requise :"
    eas login

    echo ""
    echo "  Initialisation EAS (si premier build)..."
    [ ! -f eas.json ] && eas build:configure

    echo ""
    echo "  Lancement du build preview (APK installable)..."
    eas build --platform android --profile preview --non-interactive

    echo ""
    echo "  Le lien de téléchargement APK sera affiché ci-dessus."
    echo "  Aussi accessible sur : https://expo.dev/accounts/[compte]/projects/edukraft"
    ;;

  3)
    echo -e "  ${GREEN}→ Lancement du serveur Expo Go (QR code)${RESET}"
    echo ""
    echo "  Sur ton téléphone Android :"
    echo "  1. Installe 'Expo Go' depuis le Play Store"
    echo "  2. Scanne le QR Code qui va s'afficher"
    echo ""
    $EXPO_CMD start --clear
    ;;

  *)
    echo -e "${RED}Choix invalide.${RESET}"
    exit 1
    ;;
esac
