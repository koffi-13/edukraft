# Signature Android — EduKraft

## Keystore de test versionne : `edukraft-release.keystore`

| Propriété       | Valeur                                            |
|-----------------|---------------------------------------------------|
| Format          | PKCS12                                            |
| Alias           | `androiddebugkey`                                 |
| Mot de passe    | `android` (store + key)                           |
| Validite        | 10 000 jours (genere le 2026-08-29)               |
| Empreinte SHA-256 | `65:A3:A5:F3:B8:6E:DE:1E:63:37:D1:9C:C9:EC:D0:11:48:DA:C5:5E:A6:21:85:E9:C3:DA:A2:CA:E9:59:77:2E` |

## Pourquoi ce fichier est versionne ?

Le workflow GitHub `build-release-apk.yml` copie ce keystore sur
`android/app/debug.keystore` avant `gradlew assembleRelease` (le template
Expo signe les builds release avec la config debug). Resultat : **tous les
APK produits par GitHub portent la meme signature** — une nouvelle version
s'installe par-dessus la precedente, sans desinstallation manuelle.

## Avant le Play Store (production)

1. Generer un keystore PRIVE (hors repo) :
   `keytool -genkeypair -v -keystore edukraft-prod.keystore -alias edukraft -keyalg RSA -keysize 2048 -validity 10000`
2. Le stocker dans les GitHub Secrets (base64) ou EAS Credentials.
3. Adapter le workflow pour l'injecter au moment du build.

> Ce keystore versionne convient a la phase de test/distribution directe
> (APK) uniquement — il est public dans le depot par conception.
