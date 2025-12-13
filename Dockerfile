# ---------- Build Stage ----------
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY frameworks ./frameworks

RUN npm run build

# ---------- Runtime Stage ----------
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/frameworks ./frameworks

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
