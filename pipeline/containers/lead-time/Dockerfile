# A Waymark container job: reads the inputs the runner mounts at /waymark/in and writes one
# Parquet file to /waymark/out. It runs with no network, so everything it needs is in the image.
FROM oven/bun:1.3.13-slim
WORKDIR /job
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
ENTRYPOINT ["bun", "src/main.ts"]
