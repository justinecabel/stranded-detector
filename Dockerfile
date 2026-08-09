FROM node:24-bookworm-slim AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/stranded.sqlite \
    COOKIE_SECURE=true

WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY views ./views

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "src/server.js"]
