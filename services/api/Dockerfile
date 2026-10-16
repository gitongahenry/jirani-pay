FROM node:22-slim
WORKDIR /app
COPY services/api ./services/api
COPY apps/web/public ./apps/web/public
ENV PORT=4000 DB_PATH=/data/jirani.db WEB_DIR=/app/apps/web/public
VOLUME /data
EXPOSE 4000
CMD ["node", "--disable-warning=ExperimentalWarning", "services/api/src/server.js"]
