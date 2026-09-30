FROM node:24-alpine AS build
WORKDIR /app
COPY libs/react-hooks /libs/react-hooks
COPY decision-trace-analyzer/frontend/package*.json ./
RUN npm ci
COPY decision-trace-analyzer/frontend/ .
ARG VITE_DTA_API_BASE
ENV VITE_DTA_API_BASE=$VITE_DTA_API_BASE
RUN npm run build

FROM nginx:alpine
COPY decision-trace-analyzer/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
