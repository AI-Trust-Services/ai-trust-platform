#!/bin/sh
set -e
# Render nginx.conf template — substitutes $POD_NAMESPACE so the cognee
# upstream FQDN resolves correctly regardless of which namespace is active.
envsubst '${POD_NAMESPACE}' \
    < /etc/nginx/templates/default.conf.template \
    > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
