FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public /usr/share/nginx/html
# COPY preserves host file modes; a restrictive checkout (e.g. mode 700) leaves the
# unprivileged nginx worker unable to read these files → 403. Force them readable.
RUN chmod -R a+rX /usr/share/nginx/html /etc/nginx/conf.d/default.conf
