# Simple dev-mode image. For a real production deploy, build a static
# bundle instead (`npm run build`) and serve it from Nginx or a CDN --
# `vite preview` here is a convenience for local docker-compose use only.
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 5173

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
