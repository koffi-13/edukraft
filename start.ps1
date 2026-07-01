# Script de lancement rapide pour EduKraft MVP
# Usage : .\start.ps1

Write-Host "Démarrage d'EduKraft MVP..." -ForegroundColor Green

# Utiliser Node.js 18.18.2 et activer OpenSSL legacy
$env:NODE_OPTIONS = "--openssl-legacy-provider"
$env:PATH = "C:\Program Files\node-v18.18.2-win-x64;$env:PATH"

# Vérifier si les dépendances web sont installées
if (-not (Test-Path "node_modules\react-native-web")) {
    Write-Host "Installation des dépendances web..." -ForegroundColor Yellow
    & "C:\Program Files\node-v18.18.2-win-x64\node.exe" "C:\Program Files\node-v18.18.2-win-x64\node_modules\npm\bin\npm-cli.js" install react-native-web@0.19.6 react-dom@18.2.0
}

# Lancer le serveur web
Write-Host "Lancement du serveur web..." -ForegroundColor Green
& "C:\Program Files\node-v18.18.2-win-x64\node.exe" "C:\Program Files\node-v18.18.2-win-x64\node_modules\npm\bin\npm-cli.js" run web
