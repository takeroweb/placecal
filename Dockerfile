# PlaceCal — one container: the API (Express + node:sqlite) also serves the built web app.
# Data lives in /data (mount a persistent volume there).

FROM node:24-slim AS web
WORKDIR /app
COPY web/package.json web/package-lock.json web/
RUN npm --prefix web ci
COPY web web
# the web app shares validation / pay calculation with the server
COPY server/src server/src
RUN npm --prefix web run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    AUTH_MODE=password \
    DB_FILE=/data/placecal.db \
    PORT=8080
COPY server/package.json server/package-lock.json server/
RUN npm --prefix server ci --omit=dev
COPY server/src server/src
COPY scriptable scriptable
COPY --from=web /app/web/dist web/dist
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
