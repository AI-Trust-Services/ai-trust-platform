# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_RISK_MANAGEMENT_API_BASE=/api/risk-management/v1
ARG VITE_USERS_API_BASE=/api/users/v1
ENV VITE_RISK_MANAGEMENT_API_BASE=$VITE_RISK_MANAGEMENT_API_BASE
ENV VITE_USERS_API_BASE=$VITE_USERS_API_BASE
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
