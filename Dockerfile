# Node exécute le TypeScript directement (type stripping) : pas d'étape de build.
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production DB_PATH=/app/data/bottofun.db DASHBOARD_HOST=0.0.0.0
EXPOSE 8080

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

USER node
CMD ["node", "--no-warnings", "src/bot.ts"]
