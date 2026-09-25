# Build context is repo root (not ai-system-registry/frontend/) to access shared libs
FROM node:24-alpine AS build
WORKDIR /app

# Copy shared libraries first (for better layer caching)
COPY libs/react-hooks /libs/react-hooks

# Copy frontend package.json and install deps
COPY ai-system-registry/frontend/package*.json ./
RUN npm ci

# Copy frontend source
COPY ai-system-registry/frontend/ .

ARG VITE_REGISTRY_API_BASE
ENV VITE_REGISTRY_API_BASE=$VITE_REGISTRY_API_BASE
ARG VITE_COMPLIANCE_URL
ENV VITE_COMPLIANCE_URL=$VITE_COMPLIANCE_URL
RUN npm run build

FROM nginx:alpine
COPY ai-system-registry/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
