"""Auto-sync: re-index only when the official PDF has changed.

If EUR_LEX_PDF_URL is set, downloads that URL and compares its SHA-256.
Otherwise, queries the Cellar for the latest consolidated version of the
regulation, and re-indexes only if the CELEX or PDF content changed.

Previous versions stay on disk under their own sha so older snapshots remain
queryable.
"""

from __future__ import annotations

import sys

from . import config, index, ingest


def main() -> None:
    # Resolve the target: explicit URL overrides CELEX-based discovery.
    if config.EUR_LEX_PDF_URL:
        target_celex = config.EUR_LEX_CELEX
        target_url = config.EUR_LEX_PDF_URL
    else:
        target_celex = ingest.latest_consolidated_celex()
        target_url = ingest.resolve_pdf_url(target_celex)
        print(f"latest consolidated: {target_celex}")

    tmp = config.DATA_DIR / ".sync_tmp.pdf"
    new_sha = ingest.download_pdf(tmp)

    current_sha = (
        config.CURRENT_POINTER.read_text().strip()
        if config.CURRENT_POINTER.exists()
        else None
    )

    if new_sha == current_sha:
        tmp.unlink(missing_ok=True)
        print(f"up to date (sha {new_sha[:12]}) — no re-index needed")
        return

    tmp.replace(config.PDF_PATH)
    doc_id = index.index_pdf(config.PDF_PATH, new_sha)
    index.set_current(new_sha)

    if current_sha:
        print(f"Act changed: {current_sha[:12]} -> {new_sha[:12]}")
        print(f"previous version archived at {index.version_dir(current_sha)}")
    else:
        print(f"first index built (sha {new_sha[:12]})")
    print(f"current -> {new_sha}  doc_id={doc_id}  celex={target_celex}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"sync failed: {e}", file=sys.stderr)
        sys.exit(1)
