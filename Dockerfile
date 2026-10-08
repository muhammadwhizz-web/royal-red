# ROYAL RED - multi-stage Docker build (Phase A)
#
# Build:
#   docker build -t royalred/royal-red:latest .
# Run:
#   docker run -d --name royal-red -p 3000:3000 -v royal-red-data:/data royalred/royal-red:latest
# Then open http://localhost:3000
#
# The container runs as the non-root user royalred (uid 1000) and keeps all
# state (SQLite database, workspace, box) on the /data volume.

# ---- build stage ----------------------------------------------------------

FROM oven/bun:1 AS build
WORKDIR /app

# install dependencies first so the layer caches
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install --frozen-lockfile

# copy the application and build
COPY . .
# the schema the entrypoint applies on first boot (no prisma CLI in runtime)
RUN bunx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > docker/schema.sql \
  && bun run build

# ---- runtime stage ---------------------------------------------------------

FROM debian:bookworm-slim AS runtime

# bun is the only runtime dependency; nothing else is installed on purpose
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun

# non-root user, uid 1000
RUN useradd --uid 1000 --create-home --shell /usr/sbin/nologin royalred

WORKDIR /app
ENV PORT=3000 \
    DATA_DIR=/data \
    LOG_LEVEL=info \
    NODE_ENV=production \
    DATABASE_URL=file:/data/royal-red.db \
    ROYAL_RED_WORKSPACE=/data/workspace \
    ROYAL_RED_BOX=/data/box

# the built standalone server plus everything it needs at runtime
COPY --from=build /app/.next/standalone ./.next/standalone
COPY --from=build /app/.next/static ./.next/standalone/.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/fonts ./fonts
COPY --from=build /app/docker/entrypoint.sh ./docker/entrypoint.sh
COPY --from=build /app/docker/apply-schema.ts ./docker/apply-schema.ts
COPY --from=build /app/docker/schema.sql ./docker/schema.sql
COPY --from=build /app/prisma/schema.prisma ./prisma/schema.prisma

RUN mkdir -p /data \
  && chown -R royalred:royalred /app /data \
  && chmod +x ./docker/entrypoint.sh

USER royalred
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker/entrypoint.sh"]
