"""Build and persist the PageIndex tree index, versioned by the PDF's SHA-256.

Each version lives in <INDEX_DIR>/<sha>/ (PageIndex's local store + a meta.json).
<INDEX_DIR>/current holds the sha of the active version.
"""

from __future__ import annotations

import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import config, llm_access


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def version_dir(sha: str) -> Path:
    return config.INDEX_DIR / sha


def index_pdf(pdf_path: Path, sha: str) -> str:
    """Build the tree index for pdf_path into <INDEX_DIR>/<sha>/. Returns doc_id."""
    vdir = version_dir(sha)
    vdir.mkdir(parents=True, exist_ok=True)
    client = llm_access.make_client(storage_path=str(vdir))
    print(f"Indexing {pdf_path.name} with {llm_access.summary()} ...")
    doc_id = client.submit_document(str(pdf_path), wait=True)["doc_id"]
    meta = {
        "sha256": sha,
        "doc_id": doc_id,
        "source_url": config.EUR_LEX_PDF_URL,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
        "provider": config.LLM_PROVIDER,
        "model": config.LLM_MODEL,
    }
    (vdir / "meta.json").write_text(json.dumps(meta, indent=2))
    return doc_id


def set_current(sha: str) -> None:
    config.INDEX_DIR.mkdir(parents=True, exist_ok=True)
    config.CURRENT_POINTER.write_text(sha)


def load_current() -> dict:
    """Return the active version's meta.json, or raise if nothing is indexed."""
    if not config.CURRENT_POINTER.exists():
        raise RuntimeError("No index yet — run the ingest + index scripts first.")
    sha = config.CURRENT_POINTER.read_text().strip()
    meta_path = version_dir(sha) / "meta.json"
    if not meta_path.exists():
        raise RuntimeError(f"Current index {sha} is missing meta.json — re-run index.")
    return json.loads(meta_path.read_text())


def main() -> None:
    if not config.PDF_PATH.exists():
        raise RuntimeError("No PDF — run ingest first.")
    sha = sha256_file(config.PDF_PATH)
    if (version_dir(sha) / "meta.json").exists():
        print(f"Already indexed (sha {sha[:12]}). Setting as current.")
    else:
        doc_id = index_pdf(config.PDF_PATH, sha)
        print(f"Indexed. doc_id={doc_id}")
    set_current(sha)
    print(f"current -> {sha}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"index failed: {e}", file=sys.stderr)
        sys.exit(1)
