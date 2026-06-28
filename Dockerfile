# africa-meals-api — image production (HTTP + gRPC).
#
# Contexte build (layout monorepo) :
#   africa-meals-api/
#   packages/africa-meals-field-selection/
#   packages/africa-meals-proto/
#
#   ./scripts/docker-build.sh
#   docker build -f africa-meals-api/Dockerfile -t africa-meals/api:docker .

FROM node:20-alpine AS packages
WORKDIR /app/packages/africa-meals-field-selection
COPY packages/africa-meals-field-selection/package*.json ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
COPY packages/africa-meals-field-selection/ ./
RUN npm run build

WORKDIR /app/packages/africa-meals-proto
COPY packages/africa-meals-proto/package*.json ./
RUN npm ci --ignore-scripts 2>/dev/null || npm install --ignore-scripts
COPY packages/africa-meals-proto/ ./
RUN npm run build

FROM node:20-alpine AS builder
WORKDIR /app/africa-meals-api
COPY africa-meals-api/package.json africa-meals-api/package-lock.json* ./
COPY --from=packages /app/packages /app/africa-meals-api/packages
RUN npm ci --legacy-peer-deps
COPY africa-meals-api/tsconfig.json africa-meals-api/tsconfig.build.json africa-meals-api/nest-cli.json ./
COPY africa-meals-api/src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app/africa-meals-api
ENV NODE_ENV=production
ENV NODE_PORT=9000
ENV PORT=9000
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs
COPY africa-meals-api/package.json africa-meals-api/package-lock.json* ./
COPY --from=packages /app/packages /app/africa-meals-api/packages
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force
COPY --from=builder /app/africa-meals-api/dist ./dist
USER nodejs
EXPOSE 9000 50052
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.NODE_PORT||9000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
