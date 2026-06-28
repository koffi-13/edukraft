@echo off
title EduKraft MVP - Lancement rapide

echo Démarrage d'EduKraft MVP...

REM Utiliser Node.js 18.18.2 et activer OpenSSL legacy
set NODE_OPTIONS=--openssl-legacy-provider
set PATH=C:\Program Files\node-v18.18.2-win-x64;%PATH%

REM Vérifier si les dépendances web sont installées
if not exist "node_modules\react-native-web" (
    echo Installation des dépendances web...
    "C:\Program Files\node-v18.18.2-win-x64\node.exe" "C:\Program Files\node-v18.18.2-win-x64\node_modules\npm\bin\npm-cli.js" install react-native-web@0.19.6 react-dom@18.2.0
)

REM Lancer le serveur web
echo Lancement du serveur web...
"C:\Program Files\node-v18.18.2-win-x64\node.exe" "C:\Program Files\node-v18.18.2-win-x64\node_modules\npm\bin\npm-cli.js" run web

pause
