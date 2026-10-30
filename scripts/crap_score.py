#!/usr/bin/env python3
"""
CRAP Score Calculator — Change Risk Anti-Patterns

Formula:  CRAP(m) = CC(m)^2 * (1 - coverage(m)/100)^3 + CC(m)

Inputs (produced by make crap in any backend directory):
  coverage.json  — pytest-cov JSON report  (pytest --cov=app --cov-branch --cov-report=json)
  complexity.json — radon CC JSON report   (radon cc app/ --json)

Usage:
  python3 scripts/crap_score.py [--coverage coverage.json] [--complexity complexity.json]
                                 [--threshold 30] [--fail-over 100]

Exit code 1 if any function exceeds --fail-over (default: disabled).
"""

import argparse
import json
import sys
from pathlib import Path


def load_coverage(path: str) -> dict[tuple[str, str], float]:
    """Return {(filename, function_name): branch_coverage_pct} from a coverage.py JSON report."""
    data = json.loads(Path(path).read_text())
    result: dict[tuple[str, str], float] = {}
    for file_path, file_data in data.get("files", {}).items():
        funcs = file_data.get("functions", {})
        for func_name, func_data in funcs.items():
            executed = func_data.get("executed_branches", 0)
            total = func_data.get("total_branches", 0)
            pct = (executed / total * 100) if total > 0 else 0.0
            result[(file_path, func_name)] = pct
    return result


def load_complexity(path: str) -> list[dict]:
    """Return a flat list of {file, name, cc} dicts from a radon CC JSON report."""
    data = json.loads(Path(path).read_text())
    rows = []
    for file_path, items in data.items():
        for item in items:
            rows.append(
                {
                    "file": file_path,
                    "name": item.get("name", "<unknown>"),
                    "cc": item.get("complexity", 1),
                }
            )
    return rows


def crap(cc: int, coverage_pct: float) -> float:
    return cc**2 * ((1 - coverage_pct / 100) ** 3) + cc


def risk_label(score: float) -> str:
    if score > 100:
        return "HIGH"
    if score > 30:
        return "MEDIUM"
    return "LOW"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute CRAP scores from coverage + complexity JSON"
    )
    parser.add_argument("--coverage", default="coverage.json")
    parser.add_argument("--complexity", default="complexity.json")
    parser.add_argument(
        "--threshold",
        type=float,
        default=30,
        help="Score above which a function is flagged (default: 30)",
    )
    parser.add_argument(
        "--fail-over",
        type=float,
        default=None,
        help="Exit 1 if any function exceeds this score (default: disabled)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        dest="output_json",
        help="Output results as JSON instead of a table",
    )
    args = parser.parse_args()

    try:
        cov_map = load_coverage(args.coverage)
    except FileNotFoundError:
        print(f"ERROR: coverage file not found: {args.coverage}", file=sys.stderr)
        print(
            "Run: pytest tests/unit/ --cov=app --cov-branch --cov-report=json:coverage.json",
            file=sys.stderr,
        )
        return 1

    try:
        cc_rows = load_complexity(args.complexity)
    except FileNotFoundError:
        print(f"ERROR: complexity file not found: {args.complexity}", file=sys.stderr)
        print("Run: python3 -m radon cc app/ --json > complexity.json", file=sys.stderr)
        return 1

    results = []
    for row in cc_rows:
        cov_pct = cov_map.get((row["file"], row["name"]), 0.0)
        score = crap(row["cc"], cov_pct)
        results.append(
            {
                "file": row["file"],
                "function": row["name"],
                "cc": row["cc"],
                "coverage": round(cov_pct, 1),
                "crap": round(score, 1),
                "risk": risk_label(score),
            }
        )

    results.sort(key=lambda r: r["crap"], reverse=True)

    if args.output_json:
        print(json.dumps(results, indent=2))
    else:
        flagged = [r for r in results if r["crap"] > args.threshold]
        total = len(results)
        high = sum(1 for r in results if r["risk"] == "HIGH")
        medium = sum(1 for r in results if r["risk"] == "MEDIUM")
        low = sum(1 for r in results if r["risk"] == "LOW")

        print(f"\nCRAP Score Report  (threshold: {args.threshold})")
        print(
            f"Functions analysed: {total}  |  HIGH: {high}  MEDIUM: {medium}  LOW: {low}"
        )
        print()

        if flagged:
            header = f"{'CRAP':>8}  {'CC':>4}  {'COV%':>6}  {'RISK':>6}  FUNCTION"
            print(header)
            print("-" * len(header))
            for r in flagged:
                marker = "!!" if r["risk"] == "HIGH" else " !"
                print(
                    f"{r['crap']:>8.1f}  {r['cc']:>4}  {r['coverage']:>5.1f}%  {r['risk']:>6}  {marker} {r['function']}  [{r['file']}]"
                )
        else:
            print(f"All {total} functions score <= {args.threshold}. No action needed.")

    if args.fail_over is not None:
        over = [r for r in results if r["crap"] > args.fail_over]
        if over:
            print(
                f"\n{len(over)} function(s) exceed --fail-over={args.fail_over}:",
                file=sys.stderr,
            )
            for r in over:
                print(
                    f"  {r['crap']:.1f}  {r['function']}  [{r['file']}]",
                    file=sys.stderr,
                )
            return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
