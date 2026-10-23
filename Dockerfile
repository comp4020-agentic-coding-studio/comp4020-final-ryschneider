# syntax = docker/dockerfile:1

# The image Fly builds and runs: install, build, then keep only the built
# server, its production dependencies, and README.md (the /readme/ route
# reads it at request time; spec/README.md says what's checked).

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Astro"

WORKDIR /app
ENV NODE_ENV=production

ARG PNPM_VERSION=11.9.0
RUN npm install -g pnpm@$PNPM_VERSION

# --- build stage: install everything, build, then prune to prod deps -------
FROM base AS build

# toolchain for native modules (better-sqlite3), in case no prebuilt binary
# matches the image platform
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential pkg-config python-is-python3

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

# --- runtime stage: just the built server, its deps, and README.md ---------
FROM base

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
# the committed migrations, applied at boot (see src/lib/db.ts)
COPY --from=build /app/drizzle /app/drizzle
COPY README.md /app/README.md
# rooms are seeded by hand: `flyctl ssh console -a <app-name>`, then
# `node scripts/seed-from-library.ts <text-slug>` --- these are what that
# needs once deployed
COPY --from=build /app/scripts/seed-from-library.ts /app/scripts/seed-from-library.ts
COPY --from=build /app/scripts/library /app/scripts/library
COPY --from=build /app/src/lib/schema.ts /app/src/lib/schema.ts

# fly.toml sets PORT (0.0.0.0:$PORT is what Fly's proxy forwards to)
ENV HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "./dist/server/entry.mjs"]
