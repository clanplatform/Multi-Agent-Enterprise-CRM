FROM node:20-bullseye AS builder
WORKDIR /app

# NOTE: there used to be an `apt-get install openssl libssl1.1` here. Debian 11
# (bullseye) is EOL: its security index still advertises openssl
# 1.1.1w-0+deb11u8 but the .deb files have moved to archive.debian.org, so
# apt-get update succeeds and the download 404s, failing the build for everyone:
#   E: Failed to fetch .../libssl1.1_1.1.1w-0+deb11u8_amd64.deb  404  Not Found
# It was redundant anyway -- apt reported "0 newly installed", i.e. the base
# image already ships the libssl1.1 that Prisma's debian-openssl-1.1.x engine
# needs.

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

RUN npx prisma generate

COPY . .
RUN npm run build

FROM node:20-bullseye AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev

RUN npx prisma generate

COPY --from=builder /app/dist ./dist

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
