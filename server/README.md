# EduKraft API Server

Backend minimal pour la synchronisation offline de l'application mobile EduKraft.

## Démarrage rapide

```bash
cd server
npm install
cp .env.example .env   # éditer les variables si besoin
npm run dev            # démarre sur http://localhost:3001
```

## Endpoints

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/health` | Health check |
| POST | `/api/sync` | Sync batch (endpoint principal) |
| POST | `/api/learners` | Créer/mettre à jour un learner |
| GET | `/api/learners/:clientId` | Récupérer un learner |
| GET | `/api/progress/:clientId` | Toute la progression d'un learner |
| PATCH | `/api/progress/:clientId/:moduleId` | Mettre à jour la progression |
| POST | `/api/quiz-attempts` | Enregistrer une tentative de quiz |
| POST | `/api/badges` | Enregistrer un badge (+ tx hash blockchain) |
| GET | `/api/stats` | Statistiques publiques |

## Déploiement

### Railway / Render / Fly.io
1. Connecter le repo GitHub
2. Root directory : `server`
3. Build command : `npm install`
4. Start command : `npm start`
5. Ajouter les variables d'environnement (`API_KEY`)

### VPS (DigitalOcean / Hetzner)
```bash
# Installer Node.js 18+ puis :
cd server
npm install --production
pm2 start index.js --name edukraft-api
pm2 save
pm2 startup
```