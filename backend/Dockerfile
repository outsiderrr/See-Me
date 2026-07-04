# See Me backend — Hono API + B reading web (served from ./public).
FROM node:24-slim

# openssl: required by Prisma's query engine on slim images.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate

EXPOSE 3000
# Apply migrations, then start. DATABASE_URL/OTP_SECRET come from compose.
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/main.ts"]
