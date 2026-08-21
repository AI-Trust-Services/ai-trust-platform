from __future__ import annotations

from datetime import datetime
from pathlib import Path

from risk_management.models import AuditLogEntry, RiskRegister


class AuditLogger:
    """
    Tamper-evident audit trail for risk assessment actions.
    Implements the Art. 12 logging requirement, inspired by the airblackbox pattern.
    All entries are appended to the RiskRegister.audit_log and optionally written to disk.
    """

    def __init__(self, register: RiskRegister, log_dir: str | None = None):
        self._register = register
        self._log_dir = Path(log_dir) if log_dir else None

    def log(self, action: str, entity_id: str = "", details: dict | None = None) -> AuditLogEntry:
        entry = AuditLogEntry(
            action=action,
            entity_id=entity_id,
            details=details or {},
        )
        self._register.audit_log.append(entry)
        if self._log_dir:
            self._write_to_disk(entry)
        return entry

    def log_risk_confirmed(self, risk_id: str, severity: str, notes: str = "") -> AuditLogEntry:
        return self.log("risk_confirmed", risk_id, {"severity": severity, "notes": notes})

    def log_risk_dismissed(self, risk_id: str, reason: str = "") -> AuditLogEntry:
        return self.log("risk_dismissed", risk_id, {"reason": reason})

    def log_mitigation_assigned(self, mitigation_id: str, risk_ids: list[str]) -> AuditLogEntry:
        return self.log("mitigation_assigned", mitigation_id, {"risk_ids": risk_ids})

    def log_mitigation_overridden(self, mitigation_id: str, notes: str) -> AuditLogEntry:
        return self.log("mitigation_overridden", mitigation_id, {"notes": notes})

    def log_vulnerable_group_reviewed(self, group: str, reviewed: bool, notes: str = "") -> AuditLogEntry:
        return self.log("vulnerable_group_reviewed", group, {"reviewed": reviewed, "notes": notes})

    def log_residual_risk_assessed(self, acceptable: bool, notes: str = "") -> AuditLogEntry:
        return self.log("residual_risk_assessed", "", {"acceptable": acceptable, "notes": notes})

    def log_review_completed(self) -> AuditLogEntry:
        return self.log("review_completed", "", {"timestamp": datetime.utcnow().isoformat()})

    def _write_to_disk(self, entry: AuditLogEntry) -> None:
        import json
        self._log_dir.mkdir(parents=True, exist_ok=True)
        log_file = self._log_dir / f"audit_{self._register.id[:8]}.jsonl"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(entry.model_dump_json() + "\n")

    def to_markdown(self) -> str:
        if not self._register.audit_log:
            return "*No audit entries recorded.*\n"
        lines = ["| Timestamp | Action | Entity | Details |", "|-----------|--------|--------|---------|"]
        for entry in self._register.audit_log:
            ts = entry.timestamp.strftime("%Y-%m-%d %H:%M:%S")
            details = "; ".join(f"{k}={v}" for k, v in entry.details.items()) if entry.details else "—"
            lines.append(f"| {ts} | {entry.action} | {entry.entity_id or '—'} | {details} |")
        return "\n".join(lines)
