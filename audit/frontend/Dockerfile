FROM node:24-alpine AS build
WORKDIR /app
COPY libs/react-hooks /libs/react-hooks
COPY audit/frontend/package*.json ./
RUN npm ci
COPY audit/frontend/ .
ARG VITE_AUDIT_API_BASE
ENV VITE_AUDIT_API_BASE=$VITE_AUDIT_API_BASE
ARG VITE_USERS_API_BASE
ENV VITE_USERS_API_BASE=$VITE_USERS_API_BASE
RUN npm run build

FROM nginx:alpine
COPY audit/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
