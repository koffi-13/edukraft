# Dockerfile pour le backend EduKraft (Express API)
# Build context = racine du projet. On ne copie QUE server/.

FROM node:20-slim

WORKDIR /app

# Copier UNIQUEMENT le package.json du serveur (pas celui de la racine)
COPY server/package.json server/package-lock.json* ./

# Installer les dépendances du serveur FRAÎCHES pour Linux
RUN npm install --omit=dev --legacy-peer-deps

# Copier le code du serveur SANS node_modules
# (les binaires Windows de node_modules seraient incompatibles)
COPY server/index.js server/auth.js server/gamification.js server/payments.js server/blockchain.js ./

# Créer le dossier de données
RUN mkdir -p /data

# Port que Fly.io attend
EXPOSE 8080

ENV PORT=8080
ENV DB_PATH=/data/edukraft.db
ENV NODE_ENV=production

# Démarrer le serveur Express (PAS expo start !)
CMD ["node", "index.js"]
