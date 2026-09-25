FROM node:24-alpine AS build
WORKDIR /app
COPY libs/react-hooks /libs/react-hooks
COPY users/frontend/package*.json ./
RUN npm ci
COPY users/frontend/ .
ARG VITE_USERS_API_BASE
ARG VITE_REGISTRY_API_BASE
ENV VITE_USERS_API_BASE=$VITE_USERS_API_BASE
ENV VITE_REGISTRY_API_BASE=$VITE_REGISTRY_API_BASE
RUN npm run build

FROM nginx:alpine
COPY users/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
