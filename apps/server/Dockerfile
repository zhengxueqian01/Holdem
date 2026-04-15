FROM node:20-alpine AS base
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/poker/package.json packages/poker/package.json
RUN npm install

COPY packages/poker packages/poker
COPY apps/server apps/server

RUN npm run build --workspace @holdem/poker && npm run build --workspace @holdem/server

EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
