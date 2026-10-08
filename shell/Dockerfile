FROM nginx:alpine
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY public /usr/share/nginx/html
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
