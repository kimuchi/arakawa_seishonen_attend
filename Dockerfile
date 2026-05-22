# 荒川区青少年委員連絡会 出席簿 - Cloud Run / 任意コンテナ用 Dockerfile
FROM node:22-alpine

WORKDIR /app

# 依存関係を先にコピーしてキャッシュを有効化
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

# 残りのソースをコピー
COPY server ./server
COPY public ./public

# データディレクトリ (config.json の置き場所)。
# Cloud Run の場合は Volume Mount / Secret Mount を /app/data に当てる構成を推奨。
RUN mkdir -p /app/data && chmod 700 /app/data

ENV NODE_ENV=production \
    PORT=8080 \
    TZ=Asia/Tokyo \
    CONFIG_PATH=/app/data/config.json

EXPOSE 8080
CMD ["node", "server/index.js"]
