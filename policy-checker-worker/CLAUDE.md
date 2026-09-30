# policy-checker-worker/

Standalone background worker for the **alerts** component (no HTTP port). It evaluates enabled alert rules on a poll interval and writes events to ClickHouse.

Full guidance — worker behaviour, evaluators, poll interval, event suppression — lives with the component it serves: [alerts/CLAUDE.md](../alerts/CLAUDE.md).
