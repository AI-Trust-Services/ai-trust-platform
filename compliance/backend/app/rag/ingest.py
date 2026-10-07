"""Download the official EU AI Act PDF from the Publications Office Cellar.

Resolution strategy
-------------------
1. If EUR_LEX_PDF_URL is set, use it directly (manual override).
2. Otherwise, resolve from EUR_LEX_CELEX via the Cellar SPARQL endpoint:
   - Look up the Cellar UUID for the given CELEX identifier.
   - The English PDF lives at <uuid>.0001.02/DOC_1 — a stable slot pattern
     confirmed across multiple consolidated versions of this regulation.

Cellar vs EUR-Lex delivery
--------------------------
EUR-Lex delivery URLs (eur-lex.europa.eu/legal-content/…/PDF/) are behind an
AWS WAF challenge and cannot be fetched by scripts. The Cellar
(publications.europa.eu) serves the same files via content-negotiation with no
WAF and is the authoritative source for programmatic access.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import httpx

from . import config

_CELLAR_BASE = "http://publications.europa.eu/resource/cellar"
_SPARQL = "https://publications.europa.eu/webapi/rdf/sparql"

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; eu-ai-act-rag/0.1)",
    "Accept": "*/*",
    "Accept-Language": "eng",
}


def _cellar_uuid(celex: str) -> str:
    """Return the Cellar UUID for the given CELEX identifier via SPARQL."""
    query = (
        "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>\n"
        "SELECT ?work WHERE {\n"
        f'  ?work cdm:resource_legal_id_celex "{celex}" .\n'
        "} LIMIT 1"
    )
    with httpx.Client(timeout=15) as c:
        resp = c.get(
            _SPARQL,
            params={"query": query},
            headers={"Accept": "application/sparql-results+json"},
        )
    resp.raise_for_status()
    bindings = resp.json()["results"]["bindings"]
    if not bindings:
        raise RuntimeError(
            f"CELEX {celex!r} not found in Cellar SPARQL. "
            "Check EUR_LEX_CELEX or set EUR_LEX_PDF_URL to a direct URL."
        )
    work_uri = bindings[0]["work"]["value"]
    return work_uri.split("/cellar/")[1]


def resolve_pdf_url(celex: str) -> str:
    """Return the direct Cellar PDF URL for the given CELEX identifier.

    Pattern: <uuid>.0001.02/DOC_1
      .0001 = English expression slot (consistent across consolidated versions)
      .02   = PDF/A-2a manifestation (slot .01 is FORMEX XML)
    """
    uuid = _cellar_uuid(celex)
    return f"{_CELLAR_BASE}/{uuid}.0001.02/DOC_1"


def latest_consolidated_celex(base_number: str = "2024R1689") -> str:
    """Return the CELEX of the most recent consolidated version of the regulation.

    Useful for sync.py to detect when a new amendment consolidation is published.
    """
    query = (
        "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>\n"
        "SELECT ?celex WHERE {\n"
        "  ?work cdm:resource_legal_id_celex ?celex .\n"
        f'  FILTER(STRSTARTS(?celex, "0{base_number}-"))\n'
        "} ORDER BY DESC(?celex) LIMIT 1"
    )
    with httpx.Client(timeout=15) as c:
        resp = c.get(
            _SPARQL,
            params={"query": query},
            headers={"Accept": "application/sparql-results+json"},
        )
    resp.raise_for_status()
    bindings = resp.json()["results"]["bindings"]
    if not bindings:
        raise RuntimeError(f"No consolidated versions of {base_number!r} found in Cellar.")
    return bindings[0]["celex"]["value"]


def download_pdf(dest: Path) -> str:
    """Download the Act PDF to dest. Returns its SHA-256 hex digest."""
    url = config.EUR_LEX_PDF_URL or resolve_pdf_url(config.EUR_LEX_CELEX)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=120, headers=_HEADERS) as c:
        resp = c.get(url)
        resp.raise_for_status()
        content = resp.content
    if content[:4] != b"%PDF":
        raise RuntimeError(
            f"Downloaded content is not a PDF (got {content[:16]!r}). "
            f"URL={url!r}"
        )
    dest.write_bytes(content)
    return hashlib.sha256(content).hexdigest()


def main() -> None:
    url = config.EUR_LEX_PDF_URL or resolve_pdf_url(config.EUR_LEX_CELEX)
    sha = download_pdf(config.PDF_PATH)
    size_kb = config.PDF_PATH.stat().st_size // 1024
    print(f"Downloaded {config.PDF_PATH} ({size_kb} KB)")
    print(f"source : {url}")
    print(f"sha256 : {sha}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        print(f"ingest failed: {e}", file=sys.stderr)
        sys.exit(1)
