FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# --- dev ---
# Used by docker-compose.dev.yml. The host source tree is bind-mounted over
# /app at runtime, so this stage only needs the deps + tooling baked in. The
# entrypoint runs `next dev` for live rebuilds / hot reload.
FROM base AS dev
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
# Poll the filesystem so file changes from the host bind mount are detected
# (native fs events are unreliable across the Docker VM boundary on macOS/Windows).
ENV WATCHPACK_POLLING=true
ENV CHOKIDAR_USEPOLLING=true
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN chmod +x ./docker/entrypoint.dev.sh && mkdir -p /data/uploads
EXPOSE 3000
ENTRYPOINT ["./docker/entrypoint.dev.sh"]

# --- dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
# scripts/ is needed because postinstall runs scripts/copy-tinymce.mjs
# (it self-skips when tinymce isn't extracted yet).
COPY scripts ./scripts
RUN npm ci

# --- build ---
FROM base AS build
# NEXT_PUBLIC_* vars must be present at build time (Next inlines them into the
# client bundle). Passed through from docker-compose build args.
ARG NEXT_PUBLIC_TINYMCE_API_KEY
ENV NEXT_PUBLIC_TINYMCE_API_KEY=$NEXT_PUBLIC_TINYMCE_API_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# --- runtime ---
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/src/generated ./src/generated
COPY package.json package-lock.json next.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh && mkdir -p /data/uploads

EXPOSE 3000
ENTRYPOINT ["./docker/entrypoint.sh"]
