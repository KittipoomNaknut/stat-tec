# syntax=docker/dockerfile:1

FROM node:22.23.4-bookworm-slim AS base
RUN corepack enable && mkdir -p /repo/app && chown node:node /repo/app
# Run as the image's uid-1000 user so files written into bind mounts stay owned by the host user
USER node
WORKDIR /repo/app

FROM base AS deps
COPY --chown=node:node app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Vite dev server; source is bind-mounted by docker-compose
FROM deps AS dev
EXPOSE 5173
CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "5173", "--strictPort"]

FROM deps AS build
COPY --chown=node:node app/ ./
RUN pnpm build

FROM nginx:1.28.0-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/app/dist /usr/share/nginx/html
EXPOSE 80
