FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --legacy-peer-deps
COPY . .
RUN mkdir -p /data
EXPOSE 8080
ENV PORT=8080
ENV DB_PATH=/data/edukraft.db
ENV NODE_ENV=production
CMD ["node", "index.js"]
