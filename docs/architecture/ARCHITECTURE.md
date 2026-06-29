# EduKraft — Architecture Industrielle v2

> Rapport d'analyse et de conception pour la montée en gamme du dépôt.
> Branche : `architecture/industrial-upgrade`

## Trois Piliers de Refonte

| Pilier | Pattern | Priorité |
|--------|---------|----------|
| Gamification | Event-Driven (Observer/Mediator) | 🔴 Sprint 1 |
| Parcours d'apprentissage | DAG (Directed Acyclic Graph) | 🟠 Sprint 2 |
| Quiz Dynamiques | JSON Schema v2 + Repository | 🟡 Sprint 2–3 |

## Arborescence Cible (v2)

```
src/
├── events/
│   ├── GamificationEventBus.js    # mitt.js wrapper
│   ├── events.js                   # constantes d'événements
│   └── handlers/
│       ├── XPHandler.js
│       ├── BadgeHandler.js
│       └── StreakHandler.js
├── learning/
│   ├── LearningPathEngine.js       # Évaluation DAG
│   └── AdaptiveRecommender.js
├── quiz/
│   ├── QuizGenerator.js            # Stratégies de sélection
│   ├── strategies/
│   │   ├── SequentialStrategy.js
│   │   ├── RemedialStrategy.js
│   │   └── AdaptiveStrategy.js
│   └── QuizAnalytics.js
├── repositories/                   # Repository Pattern
│   ├── LearnerRepository.js
│   ├── ProgressRepository.js
│   └── QuestionRepository.js
├── database/
│   └── schema_v2.js               # Extension additive du schema v1
└── content/
    └── modules/                   # Source unique de vérité (JSONs)
```

## Points de Friction Identifiés

1. **Couplage XP/Badges** — DbProvider est un God Object
2. **QuizScreen stub** — contenu JSON non connecté à l'UI
3. **Double registre modules** — moduleRegistry.js vs modules/*.json
4. **Parcours linéaire** — current_lesson entier, prerequisites non évalués
5. **Zéro tests automatisés** — pas de Jest, CI sans gate qualité

## Voir le rapport complet

`docs/architecture/EduKraft_Architecture_Report.docx`
