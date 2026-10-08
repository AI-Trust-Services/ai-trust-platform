"""Auto-sync: re-index only when the official PDF has changed.

Strategy:
1. Find the latest consolidated CELEX via SPARQL (cheap metadata call).
2. Compare against the CELEX stored in the current index meta.json.
3. Only if different: download the new PDF and re-index.

This means a weekly CronJob costs one SPARQL call when nothing changed —
no PDF download, no LLM indexing, no cost.
"""

from __future__ import annotations

import sys

from . import config, index, ingest


def main() -> None:
    if config.EUR_LEX_PDF_URL:
        # Manual URL override — skip CELEX discovery, fall back to SHA comparison.
        target_celex = config.EUR_LEX_CELEX
        target_url = config.EUR_LEX_PDF_URL
    else:
        target_celex = ingest.latest_consolidated_celex()
        target_url = ingest.resolve_pdf_url(target_celex)
        print(f"latest consolidated: {target_celex}")

    # Compare CELEX first — avoids downloading the PDF if nothing changed.
    try:
        current_meta = index.load_current()
        if current_meta.get("celex") == target_celex:
            print(f"up to date ({target_celex}) — no re-index needed")
            return
    except RuntimeError:
        pass  # no index yet — proceed to build

    tmp = config.DATA_DIR / ".sync_tmp.pdf"
    new_sha = ingest.download_pdf(tmp, url=target_url)

    tmp.replace(config.PDF_PATH)
    doc_id = index.index_pdf(config.PDF_PATH, new_sha, celex=target_celex)
    index.set_current(new_sha)

    try:
        current_sha = index.load_current().get("sha256", "")
        print(f"Act changed: {current_sha[:12]} -> {new_sha[:12]}")
        print(f"previous version archived at {index.version_dir(current_sha)}")
    except RuntimeError:
        print(f"first index built (sha {new_sha[:12]})")

    print(f"current -> {new_sha}  celex={target_celex}  doc_id={doc_id}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"sync failed: {e}", file=sys.stderr)
        sys.exit(1)
