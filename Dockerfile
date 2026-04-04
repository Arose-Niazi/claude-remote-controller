FROM node:20-slim

WORKDIR /app

# Copy workspace config
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/

# Install deps
RUN npm ci --workspace=packages/shared --workspace=packages/server

# Copy source and build
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
RUN npm run build --workspace=packages/shared && \
    npm run build --workspace=packages/server

# Copy pre-built web UI static files
COPY packages/web/dist/ packages/server/dist/public/

# /app/data is the persistent data directory (bind-mounted from host)
RUN mkdir -p /app/data/db /app/data/tmp /app/data/logs /app/data/config

EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
