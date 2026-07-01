# Guide d'intégration API — T-Money et Flooz
# ============================================================
# Ce document contient les informations nécessaires pour demander
# l'accès aux APIs de paiement mobile au Togo.
#
# Dernière mise à jour : Juin 2025

## ── T-Money (Togocom / Moov Africa) ─────────────────────────────────

### Contact commercial
- **Email** : partnariat@togocom.tg
- **Téléphone** : +228 22 00 00 00 (standard Togocom)
- **Site web** : https://www.tmoney.tg
- **Direction** : Direction des Partenariats et de l'Innovation

### Informations à fournir dans la demande

1. **Identité de l'entreprise**
   - Nom : EduKraft SARL (ou forme juridique)
   - RC : Numéro de registre de commerce
   - NIF : Numéro d'identification fiscale
   - Siège social : Lomé, Togo
   - Représentant légal : [Nom du gérant]

2. **Description du service**
   - EduKraft est une application éducative mobile qui permet aux apprenants
     togolais de suivre des modules de formation et d'obtenir des certifications
     vérifiables sur la blockchain Polygon.
   - Le paiement mobile sert à débloquer du contenu premium (modules avancés)
     et à certifier les badges sur la blockchain.
   - Volume estimé : 50-500 transactions/mois (croissance prévue)

3. **Spécifications techniques requises**
   - API REST pour initier des paiements (push USSD au client)
   - Webhook/callback pour les confirmations de paiement
   - Environnement de test/sandbox pour les développements
   - Montants : 500 - 2 000 FCFA par transaction

4. **Modèle de demande (à adapter)**

```
Objet : Demande d'intégration API T-Money — Service EduKraft

Madame, Monsieur,

Je soussigné(e) [Nom], représentant légal de EduKraft, souhaite demander
l'accès à l'API de paiement T-Money pour notre service d'éducation mobile.

EduKraft est une plateforme éducative permettant aux apprenants togolais
de suivre des formations et d'obtenir des certifications numériques
vérifiables. Notre application est disponible sur Android et fonctionne
également hors-ligne pour les zones à connectivité limitée.

Nous souhaitons intégrer T-Money comme moyen de paiement pour :
- Débloquer des modules de formation premium (500 FCFA)
- Certifier les badges de compétences sur la blockchain (1 000 FCFA)
- Offrir un pack complet d'accès (2 000 FCFA)

Nos besoins techniques :
- API REST d'initiation de paiement (push USSD)
- Webhook de confirmation de transaction
- Environnement sandbox pour les tests
- Volume estimé : 100-500 transactions/mois

Pièces jointes :
- Registre de commerce
- NIF
- Description technique du service

Nous restons à votre disposition pour tout complément d'information.

Cordialement,
[Nom]
[N° de téléphone]
[Email]
```

### Endpoints API T-Money (à confirmer avec leur documentation)

| Action | Méthode | Endpoint |
|--------|---------|----------|
| Initier un paiement | POST | /v2/payments/pay |
| Vérifier le statut | GET | /v2/payments/{reference}/status |
| Annuler un paiement | POST | /v2/payments/{reference}/cancel |

### Authentification
- Header `X-API-Key` : clé fournie par T-Money
- Header `X-Signature` : HMAC-SHA256 du corps de la requête
- Header `X-Timestamp` : timestamp Unix en millisecondes

---

## ── Flooz (Moov Money / Moov Africa) ─────────────────────────────────

### Contact commercial
- **Email** : partenariats@moov.africa
- **Téléphone** : +228 22 22 22 22
- **Site web** : https://www.moov.tg
- **API Portal** : https://developer.moov.money (si disponible)

### Informations à fournir
Mêmes informations que pour T-Money (voir section ci-dessus).

### Endpoints API Flooz (structure Payzone)

| Action | Méthode | Endpoint |
|--------|---------|----------|
| Initier une transaction | POST | /v1/transactions |
| Vérifier le statut | GET | /v1/transactions/{reference} |
| Consulter le solde | GET | /v1/accounts/balance |

### Authentification
- Header `Authorization: Bearer {api_key}`
- Le Bearer token est obtenu lors de l'inscription

---

## ── Étapes de mise en production ─────────────────────────────────────

### Phase A : Intégration (semaines 1-2)
1. [ ] Envoyer les demandes à T-Money et Flooz
2. [ ] Obtenir les identifiants sandbox
3. [ ] Tester les APIs en mode sandbox
4. [ ] Valider le webhook de callback

### Phase B : Déploiement contrat (semaine 2)
1. [ ] Obtenir du MATIC testnet via faucet
2. [ ] Déployer le contrat sur Polygon Amoy
3. [ ] Configurer le minter (adresse du serveur)
4. [ ] Tester le mint via le backend

### Phase C : Validation (semaine 3)
1. [ ] Test end-to-end complet (app → serveur → blockchain → paiement)
2. [ ] Test en conditions réelles (réseau 3G/Edge à Lomé)
3. [ ] Vérifier le comportement offline→online

### Phase D : Production (semaine 4)
1. [ ] Demander l'accès production aux opérateurs
2. [ ] Déployer le contrat sur Polygon Mainnet
3. [ ] Configurer les variables d'environnement production
4. [ ] Lancer en version bêta fermée (50 utilisateurs)
5. [ ] Monitorer les métriques (taux de succès, latence)

---

## ── Variables d'environnement à configurer ────────────────────────────

Une fois les accès obtenus, configurer dans `server/.env` :

```env
# T-Money
TMONEY_API_URL=https://api.tmoney.tg/v2
TMONEY_MERCHANT_ID=merchant_edukraft_001
TMONEY_API_KEY=votre_cle_api
TMONEY_API_SECRET=votre_secret_hmac

# Flooz
FLOOZ_API_URL=https://api.payzone.tg/v1
FLOOZ_MERCHANT_ID=merchant_edukraft_001
FLOOZ_API_KEY=votre_bearer_token

# Blockchain (déployer d'abord sur Amoy)
POLYGON_MOCK_MODE=false
POLYGON_NETWORK=amoy
POLYGON_CONTRACT_ADDRESS=0x...  (adresse après déploiement)
POLYGON_PRIVATE_KEY=0x...      (clé du wallet minter)

# Webhook
PAYMENT_MOCK=false
PAYMENT_WEBHOOK_SECRET=generer-un-secret-32-chars
```

## ── Coûts estimés ────────────────────────────────────────────────────

| Poste | Coût mensuel |
|-------|-------------|
| Serveur VPS (DigitalOcean/Railway) | 5-7 USD |
| Gas Polygon (mainnet, ~200 mints/mois) | ~0.10 USD |
| T-Money frais par transaction | 1-1.5% |
| Flooz frais par transaction | 1-1.5% |
| Domaine edukraft.tg | ~10 USD/an |
| **Total estimé** | **~15-25 USD/mois** |