# syntax=docker/dockerfile:1
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run b:prod

FROM oven/bun:1-slim
WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

# index.tsx does serveStatic({ root: './public' }), resolved relative to CWD
# at runtime — matches scripts/build.ts's own instruction to `cd dist && bun
# server.js`, not run from /app (which has no public/ of its own).
WORKDIR /app/dist

ENV PORT=80
EXPOSE 80

CMD ["bun", "server.js"]
