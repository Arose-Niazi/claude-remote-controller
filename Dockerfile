FROM node:20-slim AS builder

WORKDIR /app

# Copy all workspace package.json files
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/

# Install all deps (including web devDeps for build)
RUN npm ci

# Copy source
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/web/ packages/web/

# Build everything
RUN npm run build --workspace=packages/shared && \
    npm run build --workspace=packages/server && \
    npm run build --workspace=packages/web

# --- Production image ---
FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

RUN npm ci --workspace=packages/shared --workspace=packages/server --omit=dev

# Copy built artifacts
COPY --from=builder /app/packages/shared/dist/ packages/shared/dist/
COPY --from=builder /app/packages/server/dist/ packages/server/dist/
COPY --from=builder /app/packages/web/dist/ packages/server/dist/public/

RUN mkdir -p /app/data/db /app/data/tmp /app/data/logs /app/data/config

EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
