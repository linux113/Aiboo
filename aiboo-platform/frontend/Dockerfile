# ── Build stage ──────────────────────────────────────────────────
# VITE_* vars are BAKED AT BUILD TIME by Vite — passing them as runtime
# `environment:` entries does nothing. They must flow in as build ARGs.
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG VITE_API_URL=http://localhost:4000/api
ARG VITE_SOCKET_URL=http://localhost:4000
ARG VITE_CV_URL=http://localhost:5050
ARG VITE_AGENT_URL=http://localhost:8001
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SOCKET_URL=$VITE_SOCKET_URL \
    VITE_CV_URL=$VITE_CV_URL \
    VITE_AGENT_URL=$VITE_AGENT_URL
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Official nginx image auto-envsubst's /etc/nginx/templates/*.template
# into /etc/nginx/conf.d/. This lets us inject CV_AUTH_TOKEN at runtime
# so the browser never sees service credentials (streams are proxied).
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
