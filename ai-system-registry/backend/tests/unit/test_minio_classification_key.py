"""Reader/writer key agreement for classification runs.

The writer (classification_pipeline) stores under the config id's *basename*
(`config_id_short = Path(classification_config_id).name`). The reader must build
the same prefix, otherwise a nested config id like
`risk_classification/risk_role_classification_config` never matches the stored
object and the hierarchy solver 404s with a run sitting right there in MinIO.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.minio_client import _list_latest_classification_sync


def test_read_prefix_uses_config_basename():
    client = MagicMock()
    client.list_objects.return_value = []  # no objects → returns None, no get_json needed

    with patch("app.minio_client._get_client", return_value=client):
        result = _list_latest_classification_sync(
            "SYS-TESTTEST", "risk_classification/risk_role_classification_config"
        )

    assert result is None
    _, kwargs = client.list_objects.call_args
    prefix = kwargs["prefix"]
    # basename only — the nested "risk_classification/" segment must be stripped so
    # the prefix matches what the writer stored.
    assert (
        prefix == "classification-results/SYS-TESTTEST/risk_role_classification_config/"
    )
    assert "risk_classification/risk_role_classification_config" not in prefix
