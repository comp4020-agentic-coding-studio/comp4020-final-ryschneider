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

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod=false

COPY . .
RUN pnpm run build
RUN pnpm prune --prod

# --- runtime stage: just the built server, its deps, and README.md ---------
FROM base

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY README.md /app/README.md

# fly.toml sets PORT (0.0.0.0:$PORT is what Fly's proxy forwards to)
ENV HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "./dist/server/entry.mjs"]
