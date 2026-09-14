# Prerequisites — what YOU must supply

This folder holds the environment-specific inputs. Nothing here contains any
real credentials in the shipped bundle — you fill them in for **your** cluster.

## 1. `config.env` (required)

```
cp config.env.example config.env
# then edit config.env — replace every <PLACEHOLDER>
```

At minimum set `APP_DOMAIN`, `APP_URL`, and (unless `INGRESS_MODE=kind`) `REGISTRY`.
See the comments in `config.env.example` for every option.

`config.env` is git-ignored — it never leaves your machine.

## 2. Point `kubectl` at your target cluster

The scripts use whatever your `kubectl` current-context points at. Either:

```
export KUBECONFIG=/path/to/your/kubeconfig
# or
kubectl config use-context <your-cluster>
# or set KUBE_CONTEXT=<ctx> in your shell to override just for these scripts
```

## 3. Container registry (unless `INGRESS_MODE=kind`)

Set `REGISTRY` in `config.env` to a registry you can push to, and log in first:

```
docker login <your-registry>
```

Images are published as `$REGISTRY/aitrust-<component>:$TAG`.
In `kind` mode this is skipped — images are loaded straight into the kind node.

## 4. TLS certificate (only when `INGRESS_MODE=ingress` and `TLS_MODE=provided`)

Drop a PEM cert + key here as `tls.crt` and `tls.key` (see the `.example`
files). The cert's SAN must cover `APP_DOMAIN`. The deploy script turns them
into a Kubernetes TLS Secret named `app-tls`.

Alternatives (no files needed here):
- `TLS_MODE=cert-manager` + `CERT_ISSUER=<ClusterIssuer>` — cert-manager issues it.
- `TLS_MODE=none` — the app serves HTTP and TLS is terminated upstream
  (a cloud load balancer, service mesh, etc.).

`tls.crt` / `tls.key` are git-ignored.

---

### What is intentionally NOT in this bundle

To keep it portable and safe to share, the bundle ships **no** cluster
credentials, kubeconfigs, cloud-provider logins, or private keys. You provide
your own cluster access (step 2) and, if needed, your own TLS material (step 4).
