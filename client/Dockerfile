# Simple dev-mode image. For a real production deploy, build a static
# bundle instead (`npm run build`) and serve it from Nginx or a CDN --
# `vite preview` here is a convenience for local docker-compose use only.
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Vite inlines VITE_* variables into the bundle at build time, so the API
# URL must be supplied as a build arg, not a runtime environment variable.
ARG VITE_API_BASE_URL=http://localhost:5000/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

EXPOSE 5173

CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "5173"]
