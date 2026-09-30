#!/bin/sh
# Substitutes the __RESOLVER_IP__ and __SVC_SUFFIX__ placeholders in nginx.conf so the
# same image works under both Docker Compose and Kubernetes. Runs automatically: this
# directory's *.sh scripts are executed by the base nginx:alpine image's
# docker-entrypoint.sh before nginx starts.
set -eu

conf=/etc/nginx/conf.d/default.conf

resolver_ip=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf)

if [ -z "${resolver_ip:-}" ]; then
    echo "40-resolver.sh: no nameserver found in /etc/resolv.conf, leaving default resolver" >&2
    exit 0
fi

# __RESOLVER_IP__: Docker Compose's embedded DNS is always 127.0.0.11; under Kubernetes
# it's the CoreDNS/kube-dns ClusterIP, which varies per cluster.
sed -i "s/^\( *resolver \)__RESOLVER_IP__/\1${resolver_ip}/" "$conf"
echo "40-resolver.sh: nginx resolver set to ${resolver_ip}"

# __SVC_SUFFIX__: nginx's `resolver` directive does raw DNS queries and, unlike the
# system libc resolver, does NOT apply ndots/search-domain expansion. Docker Compose's
# embedded DNS resolves bare Service names directly, so no suffix is needed there. Under
# Kubernetes, CoreDNS only answers FQDNs, so bare names like "alerts-backend" fail with
# "Host not found" — detected here via the pod's own "<namespace>.svc.cluster.local"
# search domain, and appended to every internal hostname in nginx.conf.
svc_suffix=""
search_domain=$(awk '/^search/ { print $2; exit }' /etc/resolv.conf || true)
case "$search_domain" in
    *.svc.*)
        svc_suffix=".${search_domain}"
        echo "40-resolver.sh: Kubernetes detected, service suffix set to '${svc_suffix}'"
        ;;
esac

sed -i "s/__SVC_SUFFIX__/${svc_suffix}/g" "$conf"
