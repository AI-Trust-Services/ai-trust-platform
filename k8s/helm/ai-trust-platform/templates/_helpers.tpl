{{/*
Standard labels for a resource named .name
*/}}
{{- define "ai-trust.labels" -}}
app: {{ .name }}
{{- end -}}

{{/*
initContainer that blocks until a TCP port is accepting connections.
Mirrors docker-compose's `depends_on: condition: service_healthy` for
services whose healthcheck is a plain port check.
Usage: {{ include "ai-trust.waitForTcp" (dict "name" "postgres" "port" 5432 "image" .Values.waitImages.busybox) }}
*/}}
{{- define "ai-trust.waitForTcp" -}}
- name: wait-for-{{ .name }}
  image: {{ .image }}
  command:
    - sh
    - -c
    - until nc -z {{ .name }} {{ .port }}; do echo "waiting for {{ .name }}:{{ .port }}"; sleep 2; done
{{- end -}}

{{/*
initContainer that blocks until an HTTP endpoint returns 2xx/3xx.
Usage: {{ include "ai-trust.waitForHttp" (dict "name" "clickhouse" "port" 8123 "path" "/ping" "image" .Values.waitImages.busybox) }}
*/}}
{{- define "ai-trust.waitForHttp" -}}
- name: wait-for-{{ .name }}
  image: {{ .image }}
  command:
    - sh
    - -c
    - until wget -q -O- http://{{ .name }}:{{ .port }}{{ .path }} >/dev/null 2>&1; do echo "waiting for {{ .name }}:{{ .port }}{{ .path }}"; sleep 2; done
{{- end -}}

{{/*
initContainer that blocks until a Job reaches condition=complete. Requires the
pod to run under the job-waiter ServiceAccount (RBAC created by bootstrap.sh).
Mirrors docker-compose's `depends_on: condition: service_completed_successfully`.
Usage: {{ include "ai-trust.waitForJob" (dict "job" "db-migrate" "image" .Values.waitImages.kubectl) }}
*/}}
{{- define "ai-trust.waitForJob" -}}
- name: wait-for-{{ .job }}
  image: {{ .image }}
  env:
    - name: POD_NAMESPACE
      valueFrom:
        fieldRef:
          fieldPath: metadata.namespace
  # rancher/kubectl is a `FROM scratch` image (just the static kubectl binary at
  # /bin/kubectl, no shell) - rely on its ENTRYPOINT + Kubernetes' native $(VAR)
  # arg substitution instead of `sh -c` (there's no sh to invoke).
  args:
    - wait
    - --for=condition=complete
    - --timeout=600s
    - job/{{ .job }}
    - -n
    - $(POD_NAMESPACE)
{{- end -}}
