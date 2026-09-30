FROM node:24-alpine AS build
WORKDIR /app
COPY libs/react-hooks /libs/react-hooks
COPY alerts/frontend/package*.json ./
RUN npm ci
COPY alerts/frontend/ .
ARG VITE_ALERTS_API_BASE
ENV VITE_ALERTS_API_BASE=$VITE_ALERTS_API_BASE
ARG VITE_ALERTS_URL
ENV VITE_ALERTS_URL=$VITE_ALERTS_URL
ARG VITE_USERS_API_BASE
ENV VITE_USERS_API_BASE=$VITE_USERS_API_BASE
RUN npm run build

FROM nginx:alpine
COPY alerts/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
