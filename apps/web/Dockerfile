FROM node:20-alpine AS base
WORKDIR /app

COPY package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm install

COPY apps/web apps/web
RUN npm run build --workspace @holdem/web

EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace", "@holdem/web", "--", "--host", "0.0.0.0", "--port", "5173"]
