FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src ./src
COPY config ./config
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["node", "src/index.js"]
