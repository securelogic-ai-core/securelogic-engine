FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json

RUN npm install

COPY . .

RUN npm run build

ENV NODE_ENV=production

CMD ["node", "dist/api/server.js"]
