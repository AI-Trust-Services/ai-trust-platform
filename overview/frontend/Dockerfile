FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_OVERVIEW_API_BASE
ENV VITE_OVERVIEW_API_BASE=$VITE_OVERVIEW_API_BASE
ARG VITE_ALERTS_API_BASE
ENV VITE_ALERTS_API_BASE=$VITE_ALERTS_API_BASE
ARG VITE_ALERTS_URL
ENV VITE_ALERTS_URL=$VITE_ALERTS_URL
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
