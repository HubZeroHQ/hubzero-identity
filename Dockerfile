FROM node:22.14.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build && npm run build:server

FROM node:22.14.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
RUN npm prune --omit=dev
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health/live').then((r) => process.exit(r.status === 204 ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "run", "start"]
