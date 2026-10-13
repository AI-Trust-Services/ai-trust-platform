# Frozen cognee knowledge-graph snapshot, shipped as an immutable OCI artifact.
#
# This is a DATA image, not a service. It is built ONLY by
# .github/workflows/promote-graph.yml when an operator promotes an
# expert-approved graph — never by the normal CI/kind/bake build paths.
#
# busybox (not scratch) is the base so the prod init container's
# `tar xzf /graph.tar.gz -C /app/.cognee_system` has a `tar` binary to run.
# The build context must contain graph.tar.gz (exported via kubectl exec,
# excluding cognee_eval.db) and manifest.json (provenance), both produced by
# the promotion workflow.
FROM busybox:1.37.0@sha256:bdf57e528e45e4433820e045b29b4597825a1c9e38353532d90a01445013f82e

COPY graph.tar.gz /graph.tar.gz
COPY manifest.json /manifest.json
