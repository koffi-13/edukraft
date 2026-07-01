FROM node:20-slim

WORKDIR /app

# Copier package.json et installer les dépendances
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --legacy-peer-deps

# Copier le code serveur
COPY . .

# Créer le dossier de données (sera monté sur le volume Fly.io)
RUN mkdir -p /data

# Exposer le port
EXPOSE 3001

# Variables par défaut
ENV PORT=3001
ENV DB_PATH=/data/edukraft.db
ENV NODE_ENV=production

# Démarrer le serveur
CMD ["node", "index.js"]
