# Dockerfile pour le backend EduKraft (Express API)
# IMPORTANT : ce fichier est dans server/ mais le build context est la racine.
# On ne copie QUE les fichiers du dossier server/ — pas le frontend.

FROM node:20-slim

WORKDIR /app

# Copier UNIQUEMENT le package.json du serveur (pas celui de la racine)
COPY server/package.json server/package-lock.json* ./

# Installer les dépendances du serveur
RUN npm install --omit=dev --legacy-peer-deps

# Copier UNIQUEMENT les fichiers du serveur
COPY server/ ./

# Créer le dossier de données
RUN mkdir -p /data

# Port que Fly.io attend
EXPOSE 8080

ENV PORT=8080
ENV DB_PATH=/data/edukraft.db
ENV NODE_ENV=production

# Démarrer le serveur Express (PAS expo start !)
CMD ["node", "index.js"]
