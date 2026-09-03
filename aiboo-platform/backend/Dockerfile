# syntax=docker/dockerfile:1
# Non-root, production-only deps.
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node . .
USER node
EXPOSE 4000
# Backend exits at boot if default secrets are set — fail fast in orchestration too.
CMD ["node", "server.js"]
