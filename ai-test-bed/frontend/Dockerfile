FROM node:24-alpine AS build
WORKDIR /app
COPY libs/react-hooks /libs/react-hooks
COPY ai-test-bed/frontend/package*.json ./
RUN npm ci
COPY ai-test-bed/frontend/ .
ARG VITE_TESTBED_API_BASE
ENV VITE_TESTBED_API_BASE=$VITE_TESTBED_API_BASE
ARG VITE_INDEXING_API_BASE
ENV VITE_INDEXING_API_BASE=$VITE_INDEXING_API_BASE
ARG VITE_USERS_API_BASE
ENV VITE_USERS_API_BASE=$VITE_USERS_API_BASE
ARG VITE_REGISTRY_API_BASE
ENV VITE_REGISTRY_API_BASE=$VITE_REGISTRY_API_BASE
RUN npm run build

FROM nginx:alpine
COPY ai-test-bed/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
