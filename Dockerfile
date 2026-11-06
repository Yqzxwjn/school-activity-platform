# 学校活动在线服务平台 V1.0
# 构建：docker build -t school-activity .
# 运行：docker run -d -p 3000:3000 -v activity-data:/app/data --name school-activity school-activity

FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DB_PATH=/app/data/app.db \
    SEED_PASSWORD=xbh2026

COPY --chown=node:node package.json server.js ./
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -q -O - http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
