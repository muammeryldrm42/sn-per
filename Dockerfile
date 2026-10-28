# Shared scanner worker. Any Docker host works (VPS, Railway, Fly, Render, Koyeb).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY . .
ENV PORT=8787 DATA_DIR=/app/data NODE_ENV=production
VOLUME ["/app/data"]
EXPOSE 8787
CMD ["npm", "run", "worker"]
