# Build context is repo root (not admin/frontend/) to access shared libs
FROM node:24-alpine AS build
WORKDIR /app

# Copy shared libraries first (for better layer caching)
COPY libs/react-hooks /libs/react-hooks

# Copy frontend package.json and install deps
COPY admin/frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY admin/frontend/ .

ARG VITE_ADMIN_API_BASE
ENV VITE_ADMIN_API_BASE=$VITE_ADMIN_API_BASE
RUN npm run build

FROM nginx:alpine
COPY admin/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
