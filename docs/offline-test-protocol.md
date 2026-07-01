# Protocole de Test Offline-First - EduKraft MVP
## Certification avant ouverture de hub régional

> **Règle absolue :** Aucun hub de niveau 2 ou 3 ne peut être ouvert sans le certificat de réussite des Phases A et B signé par le responsable technique.

---

## Vue d'ensemble des 3 phases

| Phase | Environnement | Durée | Participants | Critère de passage |
|-------|--------------|-------|-------------|-------------------|
| **A** | Laboratoire (Lomé) | 1 jour | Équipe tech (3 personnes) | 100 % tests automatisés + 0 crash manuel |
| **B** | Terrain semi-urbain (Kara) | 4 semaines | 50 bêta-testeurs | Complétion > 85 %, NPS > 40, 0 bug bloquant |
| **C** | Rural (villages Sokodé) | 1 semaine | 20 testeurs ciblés | 100 % données préservées, sync différée conforme |

---

## PHASE A - Laboratoire (Lomé)

### Objectif
Valider que la couche SQLite + sync engine résiste à tous les scénarios réseau simulables en conditions contrôlées.

### Exécution des tests automatisés

**Depuis l'écran Profil de l'application (mode `__DEV__`) :**
```
Profil -> DevTools -> "Lancer les tests offline"
```

**Ou en ligne de commande :**
```bash
npx jest src/utils/offlineTestRunner.test.js --verbose
```

**9 tests automatisés :**
1. Écriture locale SQLite sans réseau
2. Persistance progression module (3 updates)
3. Sauvegarde quiz offline (score + réponses)
4. Génération badge + QR offline
5. File sync_queue - cohérence enqueue
6. Retry exponentiel - compteur
7. Intégrité données post-redémarrage DB
8. Session offline longue - 50 opérations sans perte
9. Accumulation XP - addXP(n) × 3 sans écrasement

**Critère de passage Phase A :** 9/9 tests réussis, dont les 6 marqués "critical".

---

### Tests manuels Phase A

#### A1 - Simulation réseau dégradé
**Outil :** Android Studio -> Device Manager -> Virtual Device -> Network Throttling

| Profil réseau | Action à tester | Résultat attendu |
|--------------|----------------|-----------------|
| No Internet | Compléter une leçon + quiz |  Score sauvé localement |
| 2G (50 Kbps, latence 800ms) | Ouvrir l'app, naviguer |  Aucun spinner infini |
| 30% packet loss | Déclencher sync manuelle |  Retry automatique visible |
| Coupure réseau en milieu de sync | Observer la queue |  Données non corrompues |

#### A2 - Appareils Android Go Edition (1 Go RAM)
**Téléphones de test recommandés :**
- Samsung Galaxy A03 Core
- Itel S23
- Tecno Pop 7

**Vérifications :**
- [ ] Application se lance en < 3 secondes
- [ ] Aucun crash OOM (Out of Memory) sur 30 min d'utilisation
- [ ] SQLite WAL mode actif (`PRAGMA journal_mode` retourne `wal`)
- [ ] Assets SVG chargés sans artefact visuel

#### A3 - Test de concurrence SQLite
```bash
# Ouvrir 2 onglets dans Expo Go, même compte
# Déclencher 2 sauvegardes simultanées
# Vérifier qu'aucune n'écrase l'autre
```
**Critère :** Les 2 enregistrements sont présents dans la DB.

---

### Formulaire de certification Phase A

```
Date : ____________________
Testeur : ____________________
Version de l'app : ____________

Tests automatisés : __ / 9   (minimum requis : 9/9)
Tests manuels A1  : __ / 4   (minimum requis : 4/4)
Tests manuels A2  : __ / 4   (minimum requis : 4/4)
Tests manuels A3  : __ / 1   (minimum requis : 1/1)

RÉSULTAT PHASE A :  CERTIFIÉE     ÉCHOUÉE

Signature responsable technique : ____________________
```

---

## PHASE B - Terrain semi-urbain (Kara)

### Objectif
Valider l'expérience utilisateur réelle sur 4 semaines avec des apprenants non-techniques, en connexion 2G/3G alternée.

### Recrutement des bêta-testeurs

**Profil cible :** 50 personnes
- 20 étudiants Université de Kara (18-25 ans)
- 20 artisans / commerçants (25-40 ans)
- 10 femmes rurales en périphérie de Kara (accès réseau limité)

**Appareils fournis pour le test :**
- 15 smartphones Tecno/Itel Android Go (1 Go RAM)
- 10 smartphones mid-range (Samsung A-series)
- 25 appareils personnels des testeurs

### Métriques à suivre (tableau de bord hebdomadaire)

| Métrique | Semaine 1 | Semaine 2 | Semaine 3 | Semaine 4 | Cible |
|---------|-----------|-----------|-----------|-----------|-------|
| Apprenants actifs (1 leçon) | | | | | 45/50 |
| Taux de complétion de module | | | | |  85 % |
| Bugs bloquants reportés | | | | | 0 |
| NPS (Net Promoter Score) | | | | |  40 |
| Badges émis | | | | |  80 |
| Sessions offline détectées | | | | | mesure |

### Bugs : classification et délai de correction

| Sévérité | Définition | Délai correction |
|----------|-----------|-----------------|
|  Bloquant | L'apprenant ne peut pas continuer | 24h max |
|  Majeur | Fonctionnalité dégradée, contournement possible | 72h |
|  Mineur | UX dégradée, non bloquant | Sprint suivant |
|  Cosmétique | Visuel incorrect, sans impact fonctionnel | Backlog |

**Critère de passage Phase B :**
- 0 bug bloquant non résolu en fin de semaine 4
- Taux de complétion  85 %
- NPS  40
- 0 perte de données signalée

### Questionnaire NPS (envoyé à S2 et S4)

```
1. Sur une échelle de 0 à 10, recommanderais-tu EduKraft à un ami ?
   [ 0 ] [ 1 ] [ 2 ] [ 3 ] [ 4 ] [ 5 ] [ 6 ] [ 7 ] [ 8 ] [ 9 ] [ 10 ]

2. Est-il arrivé que l'application ne fonctionne pas alors que tu n'avais 
   pas de réseau ?    Oui (décrire : ___)    Non

3. As-tu perdu des données (progression, quiz, badge) ?
    Oui (décrire : ___)    Non

4. Ce qui t'a le plus aidé dans l'application (texte libre) :
   _______________________________________________

5. Ce que tu changerais en priorité (texte libre) :
   _______________________________________________
```

---

## PHASE C - Terrain rural (villages autour de Sokodé)

### Objectif
Validation extrême : zéro connexion pendant 72h consécutives, appareils Android Go uniquement.

### Conditions de test
- **Localisation :** 3 villages à 20-40 km de Sokodé (zone sans 3G)
- **Connexion disponible :** GSM voix uniquement (pas de données)
- **Durée :** 7 jours (3 jours offline strict + 4 jours avec sync partielle 2G)

### Scénarios testés

#### C1 - 72h sans aucune connexion data
```
J1 matin   -> Installer l'app + créer profil (avec connexion)
J1 soir    -> Désactiver data et Wi-Fi manuellement
J2 complet -> Compléter 2 leçons, 2 quiz (offline total)
J3 complet -> Générer 1 badge (offline total)
J4 matin   -> Réactiver data (2G) -> observer sync automatique
```

**Vérifications J4 :**
- [ ] Progression J2-J3 toujours présente dans l'app
- [ ] Badge généré offline présente un QR code fonctionnel
- [ ] Sync se déclenche automatiquement dans les 30 secondes
- [ ] Compteur "En attente sync" revient à 0 après sync

#### C2 - Redémarrage téléphone en mode offline
```
Compléter une leçon -> Éteindre le téléphone -> Rallumer -> Vérifier progression
```
**Critère :** Données 100 % préservées après redémarrage.

#### C3 - Batterie à plat en cours de quiz
```
Quiz démarré -> Couper l'alimentation brusquement -> Relancer -> Vérifier état
```
**Critère :** Au pire, le quiz recommence depuis le début. Jamais de données corrompues.

### Formulaire de certification Phase C

```
Date début : ________________  Date fin : ________________
Responsable terrain : ____________________
Nombre de testeurs : ____  Appareils Android Go : ____

C1 - 72h offline -> Données préservées :  Oui   Non   Partiel
C1 - Sync auto au retour réseau      :  Oui   Non
C2 - Redémarrage téléphone           :  Oui   Non
C3 - Coupure batterie                :  Oui   Non

Incidents documentés :
_______________________________________________

RÉSULTAT PHASE C :  CERTIFIÉE     ÉCHOUÉE

Signature responsable terrain : ____________________
Signature CTO : ____________________
```

---

## Récapitulatif des certifications pour ouverture hub

| Hub | Condition d'ouverture |
|-----|----------------------|
| **Hub 1 - Lomé** | Phase A certifiée |
| **Hub 2 - Kara** | Phases A + B certifiées |
| **Hub 3 - Sokodé** | Phases A + B + C certifiées |

**Les certificats signés sont à conserver dans :** `docs/certifications/`  
**Contact technique :** dev@edukraft.tg
