# One build, three targets: `app` runs the API (default), the worker (`node apps/worker/dist/main.js`)
# and migrations (`npx prisma migrate deploy`); `web` serves the React build behind Caddy.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY . .
RUN npx prisma generate \
  && npm run build -w @pm/api \
  && npm run build -w @pm/worker \
  && npm run build -w @pm/web

FROM node:22-bookworm-slim AS app
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
# node_modules keeps the Prisma CLI for `migrate deploy`; simplicity over image size.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
# prisma/seed.ts (one-time platform admin provisioning) imports the password helper from source.
COPY --from=build /app/apps/api/src/lib/password.ts ./apps/api/src/lib/password.ts
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]

FROM caddy:2-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
