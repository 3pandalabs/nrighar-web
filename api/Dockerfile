# Multi-stage build: compile TypeScript in a full node image, run on a slim one.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle

# Coolify/Traefik terminates TLS in front of this container; it only ever
# needs to listen on plain HTTP inside the private Docker network.
RUN addgroup -S nrighar && adduser -S nrighar -G nrighar
USER nrighar

EXPOSE 8080
# Apply pending Drizzle migrations before starting the server. Runs the
# *compiled* migrator (dist/db/migrate.js) — the `npm run db:migrate` script
# uses tsx + src/, neither of which exists in this --omit=dev runtime image, so
# it silently never ran and schema drift (e.g. a missing `bedrooms` column)
# reached prod. Baking it into CMD makes it deploy-order-proof instead of
# depending on a Coolify pre-deploy field being set correctly. Fail-fast: if a
# migration errors the container won't start, surfacing the problem loudly.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
