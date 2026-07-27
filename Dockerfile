# syntax=docker/dockerfile:1
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run b:prod

FROM oven/bun:1-slim
WORKDIR /app

# DB/env config: never checked into VC, so it can't come from the build
# stage's `COPY . .`. Two sources, mutually exclusive:
#   - local dev: a real .env already sits next to the Dockerfile — COPY it
#     in as-is (the `.env*` glob is a no-op, not an error, when absent).
#   - GHA: no .env exists in the checked-out repo, so the workflow passes
#     these as --build-arg, sourced from the org's secrets/variables. If no
#     .env was copied in, synthesize one from the args instead.
ARG DEV_WAYMARK_SOURCE_DB_ADAPTER=""
ARG DEV_WAYMARK_SOURCE_DB_URL=""
ARG DEV_WAYMARK_SOURCE_DB_SEED=""
ARG DEV_WAYMARK_APP_DB_ADAPTER=""
ARG DEV_WAYMARK_APP_DB_URL=""
ARG LOG_LEVEL=""

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY .env* ./dist/

RUN if [ ! -f ./dist/.env ]; then \
      { \
        echo "DEV_WAYMARK_SOURCE_DB_ADAPTER=$DEV_WAYMARK_SOURCE_DB_ADAPTER"; \
        echo "DEV_WAYMARK_SOURCE_DB_URL=$DEV_WAYMARK_SOURCE_DB_URL"; \
        echo "DEV_WAYMARK_SOURCE_DB_SEED=$DEV_WAYMARK_SOURCE_DB_SEED"; \
        echo "DEV_WAYMARK_APP_DB_ADAPTER=$DEV_WAYMARK_APP_DB_ADAPTER"; \
        echo "DEV_WAYMARK_APP_DB_URL=$DEV_WAYMARK_APP_DB_URL"; \
        echo "LOG_LEVEL=$LOG_LEVEL"; \
      } > ./dist/.env; \
    fi

# index.tsx does serveStatic({ root: './public' }), resolved relative to CWD
# at runtime — matches scripts/build.ts's own instruction to `cd dist && bun
# server.js`, not run from /app (which has no public/ of its own).
WORKDIR /app/dist

ENV PORT=80
EXPOSE 80

CMD ["bun", "server.js"]
