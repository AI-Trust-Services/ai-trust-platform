# Add RabbitMQ Consumer

Create a new RabbitMQ consumer under `consumers/` that subscribes to the `otel.traces` fanout exchange.

## Usage

```
/add-consumer <name> <description>
```

**Example**: `/add-consumer sse-consumer "streams live GenAI spans to browser clients via SSE"`

## What this skill does

1. Creates `consumers/<name>/` with all required files
2. Adds the matching Deployment to the k8s Helm chart

---

## Instructions

The argument format is: `<consumer-name> <one-line description>`

Parse `$ARGUMENTS` — the first word is the consumer name (kebab-case), the rest is the description.

### Step 1 — Read existing files first

Read these files before making any changes:
- `consumers/clickhouse-consumer/main.py` — reference implementation
- `consumers/clickhouse-consumer/Dockerfile` — reference Dockerfile
- `consumers/clickhouse-consumer/requirements.txt` — reference requirements

### Step 2 — Create `consumers/<name>/requirements.txt`

```
aio-pika==9.4.3
```

Add any additional dependencies the user described (e.g. `sse-starlette` for SSE, `fastapi` + `uvicorn` for HTTP consumers).

### Step 3 — Create `consumers/<name>/Dockerfile`

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chmod +x entrypoint.sh
CMD ["./entrypoint.sh"]
```

### Step 4 — Create `consumers/<name>/entrypoint.sh`

```bash
#!/bin/sh
set -e
python main.py
```

For HTTP consumers (SSE, REST): `uvicorn app.main:app --host 0.0.0.0 --port <port> --no-access-log`

### Step 5 — Create `consumers/<name>/main.py`

Model it on `consumers/clickhouse-consumer/main.py` (read that file first). Key rules:
- `RABBITMQ_URL = os.environ["RABBITMQ_URL"]` — fail-fast, no default
- `QUEUE_NAME` must be unique across all consumers (each gets its own copy via the fanout)
- Queue declared as `durable=True` — survives consumer restarts; messages accumulate while consumer is down
- Replace the clickhouse-specific logic with the new consumer's logic; keep the RabbitMQ plumbing identical

### Step 6 — Add the matching Deployment to the k8s Helm chart

Read `k8s/helm/ai-trust-platform/templates/otel.yaml` (the `otel-clickhouse-consumer` Deployment)
as the reference pattern, then add a new Deployment for `<consumer-name>` to the same file (or a
new template file if it doesn't fit thematically):

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: <consumer-name>
spec:
  replicas: 1
  selector:
    matchLabels:
      {{- include "ai-trust.labels" (dict "name" "<consumer-name>") | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "ai-trust.labels" (dict "name" "<consumer-name>") | nindent 8 }}
    spec:
      initContainers:
        # mirrors compose: <consumer-name> depends_on rabbitmq (service_healthy)
        {{- include "ai-trust.waitForTcp" (dict "name" "rabbitmq" "port" 5672 "image" .Values.waitImages.busybox) | nindent 8 }}
      containers:
        - name: <consumer-name>
          image: {{ .Values.image.repository }}/<consumer-name>:{{ .Values.image.tag }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          envFrom:
            - secretRef: { name: {{ .Values.secretName }} } # RABBITMQ_URL
```

Add an HTTP `readinessProbe`/`Service` too if the consumer exposes a port (same as
`otel-rmq-bridge` in that file). Then add `<consumer-name>` to the image list in
`k8s/scripts/build-and-load-images.sh`.

### Step 7 — Report back

Tell the user:
- Files created
- The `QUEUE_NAME` used (important — must be unique)
- Any TODOs left in `main.py` for them to fill in
- How to test: `make build && make upgrade` (rebuilds and reloads into the kind cluster)
