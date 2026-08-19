# Backend only. The SPA is built separately and deployed to Firebase Hosting
# (DEPLOYMENT.md §4) — nothing under frontend/ belongs in this image.
FROM node:24-slim
WORKDIR /app

# `npm ci` must run inside the Linux image: @libsql/client resolves a
# platform-specific native binding through libsql's optionalDependencies, so a
# node_modules copied from a Windows host ships a binary that cannot load.
# .dockerignore excludes node_modules for exactly this reason.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# No build step by design — tsx (a runtime dependency) strips types on the fly.
# shared/ is required: src/server/index.ts imports ../../shared/apiTypes.js.
# The migration .sql files ride along inside src/, where src/db/migrate.ts
# resolves them relative to its own module URL.
COPY tsconfig.json ./
COPY shared ./shared
COPY src ./src

ENV NODE_ENV=production
CMD ["npm", "start"]
