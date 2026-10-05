# Two images from one build (docker-compose.yml picks the target):
#   api – Node running the Fastify API from TypeScript source (tsx), like `npm start`
#   web – Caddy serving the built web app and proxying /api/* and /files/* to the api

# --- Dependencies and the web build -------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Workspace manifests first, so `npm ci` stays cached until a dependency changes.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# --- API --------------------------------------------------------------------------------
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
# The API runs from source with tsx (a dev dependency), so node_modules is copied whole.
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]

# --- Web --------------------------------------------------------------------------------
FROM caddy:2-alpine AS web
COPY deploy/docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
EXPOSE 8080
