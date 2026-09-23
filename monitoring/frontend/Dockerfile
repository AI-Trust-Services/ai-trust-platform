FROM node:24-alpine AS build
WORKDIR /app
COPY libs/react-hooks /libs/react-hooks
COPY monitoring/frontend/package*.json ./
RUN npm ci
COPY monitoring/frontend/ .
ARG VITE_MONITORING_API_BASE
ENV VITE_MONITORING_API_BASE=$VITE_MONITORING_API_BASE
RUN npm run build

FROM nginx:alpine
COPY monitoring/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
