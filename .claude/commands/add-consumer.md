# Add RabbitMQ Consumer

Create a new RabbitMQ consumer under `consumers/` that subscribes to the `otel.traces` fanout exchange.

## Usage

```
/add-consumer <name> <description>
```

**Example**: `/add-consumer sse-consumer "streams live GenAI spans to browser clients via SSE"`

## What this skill does

1. Creates `consumers/<name>/` with all required files
2. Adds the service to `docker-compose.yml`
3. Adds the matching Deployment to the k8s Helm chart (this app has two independent, fully-supported
   deployment paths — docker-compose and k8s/kind — that must be kept in sync; see CLAUDE.md's
   "Dual deployment paths" section)

---

## Instructions

The argument format is: `<consumer-name> <one-line description>`

Parse `$ARGUMENTS` — the first word is the consumer name (kebab-case), the rest is the description.

### Step 1 — Read existing files first

Read these files before making any changes:
- `docker-compose.yml` — to understand the current structure and find where to add the new service
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

### Step 6 — Add service to `docker-compose.yml`

Find the `x-rmq-env: &rmq-env` anchor. Add the new service after `otel-clickhouse-consumer`:

```yaml
  <consumer-name>:
    build: ./consumers/<consumer-name>
    environment:
      RABBITMQ_URL: amqp://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@rabbitmq:5672/
    depends_on:
      rabbitmq:
        condition: service_healthy
    restart: on-failure
```

If the consumer exposes an HTTP port, add a `ports:` entry and a `healthcheck:`.

**YAML merge key note**: YAML does not allow two `<<:` merge keys in the same mapping. If this service needs both `*rmq-env` and another anchor (e.g. `*ch-env`), expand the variables inline instead of using `<<:`.

### Step 7 — Add the matching Deployment to the k8s Helm chart

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

### Step 8 — Report back

Tell the user:
- Files created
- The `QUEUE_NAME` used (important — must be unique)
- Any TODOs left in `main.py` for them to fill in
- How to test: `docker compose up --build -d <consumer-name>` then watch logs (docker-compose path),
  and `cd k8s && make build && make upgrade` (k8s path)
