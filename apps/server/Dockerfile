# Contexto de build: raíz del monorepo.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/client/package.json packages/client/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/server -w packages/shared
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build -w packages/shared && npm run build -w apps/server

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/client/package.json packages/client/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/server --omit=dev
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/server/dist apps/server/dist
COPY apps/server/migrations apps/server/migrations
WORKDIR /app/apps/server
EXPOSE 3000
CMD ["node", "dist/index.js"]
