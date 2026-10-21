FROM node:24-bookworm-slim AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
# Optional build-only trust bundle for managed networks; never disable TLS checks.
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca; fi; \
    npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
COPY public ./public
COPY scripts/prepare-demo.mjs ./scripts/prepare-demo.mjs
RUN npm run prepare:demo && npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --chown=node:node server ./server
COPY --chown=node:node package.json ./package.json
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 TRUST_PROXY=1 DATA_DIR=/tmp/pipelife-review
EXPOSE 3001
CMD ["node", "server/index.mjs"]
