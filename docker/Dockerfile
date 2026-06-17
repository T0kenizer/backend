FROM node:24-alpine AS builder

WORKDIR /app

# Install all deps; do NOT skip scripts so @tokenizer/shared's `prepare`
# script builds its dist/ (the published GitHub package does not ship dist/).
COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src ./src

RUN npm run build

FROM node:24-alpine AS migrator

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package*.json tsconfig*.json mikro-orm.config.ts ./
COPY migrations ./migrations

CMD ["npx", "mikro-orm", "migration:up"]

FROM node:24-alpine AS deps

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules

RUN npm prune --production

FROM node:24-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

RUN addgroup -S tokenizer && adduser -S tokenizer -G tokenizer
USER tokenizer

EXPOSE 3000

CMD ["npm", "run", "start:prod"]