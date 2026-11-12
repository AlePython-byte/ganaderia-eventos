# Una sola imagen para los cuatro servicios y la herramienta de demo.
# El servicio que corre se elige con la variable SERVICE (ver docker-compose.yml).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY shared ./shared
COPY services ./services
COPY tools ./tools

ARG SERVICE=ingestion
ENV SERVICE=${SERVICE}
USER node
# `exec` hace que node reciba SIGTERM y cierre ordenadamente.
CMD ["sh", "-c", "exec node services/${SERVICE}/index.js"]
