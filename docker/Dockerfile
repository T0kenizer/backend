FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json mikro-orm.config.ts ./
COPY src ./src
COPY migrations ./migrations

RUN npm run build && npm run build:migrations

FROM node:24-alpine AS migrator

ENV NODE_ENV=production
ENV MIKRO_ORM_CLI_USE_TS_NODE=false

WORKDIR /app

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

CMD ["npx", "mikro-orm", "migration:up"]

FROM node:24-alpine AS runner

ENV NODE_ENV=production

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

RUN npm prune --omit=dev

RUN addgroup -S tokenizer && adduser -S tokenizer -G tokenizer
USER tokenizer

EXPOSE 3000

CMD ["npm", "run", "start:prod"]