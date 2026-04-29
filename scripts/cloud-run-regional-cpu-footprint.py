#!/usr/bin/env python3
"""
Estime le pic mCPU régional Cloud Run : somme (CPU par instance × max instances)
pour chaque service (approximation du quota CpuAllocPerProjectRegion).

Usage :
  python3 scripts/cloud-run-regional-cpu-footprint.py [REGION] [PROJECT]
  REGION défaut : europe-west1
  PROJECT défaut : projet gcloud courant
"""
from __future__ import annotations

import json
import subprocess
import sys
from typing import Any, Optional


def gcloud_json(argv: list[str]) -> Any:
    out = subprocess.check_output(argv, text=True)
    return json.loads(out) if out.strip() else None


def cpu_to_millicores(cpu: str) -> int:
    cpu = str(cpu).strip().strip('"').strip("'")
    if not cpu:
        return 1000
    if cpu.endswith("m"):
        return int(float(cpu[:-1]))
    return int(float(cpu) * 1000)


def max_scale_from_annotations(ann: dict) -> Optional[int]:
    if not ann:
        return None
    for k, v in ann.items():
        if k.endswith("maxScale") or k.endswith("max-scale"):
            try:
                return int(str(v).strip())
            except ValueError:
                continue
    return None


def describe_service(name: str, region: str, project: Optional[str]) -> dict:
    cmd = [
        "gcloud",
        "run",
        "services",
        "describe",
        name,
        f"--region={region}",
        "--format=json",
    ]
    if project:
        cmd.insert(1, f"--project={project}")
    return gcloud_json(cmd)  # type: ignore[return-value]


def main() -> int:
    region = sys.argv[1] if len(sys.argv) > 1 else "europe-west1"
    project = sys.argv[2] if len(sys.argv) > 2 else None

    cmd = ["gcloud", "run", "services", "list", f"--region={region}", "--format=json"]
    if project:
        cmd.insert(1, f"--project={project}")
    raw = gcloud_json(cmd)
    if raw is None:
        print("Aucun service Cloud Run dans cette région.")
        return 0

    if isinstance(raw, list):
        items = raw
    elif isinstance(raw, dict):
        items = raw.get("items") or raw.get("services") or []
    else:
        items = []

    rows: list[tuple[str, str, str, int]] = []
    total = 0

    for item in items:
        name = item.get("metadata", {}).get("name", "?")
        d = describe_service(name, region, project)
        tpl = d.get("spec", {}).get("template", {})
        ann = tpl.get("metadata", {}).get("annotations") or {}
        max_i = max_scale_from_annotations(ann)
        lim = (
            tpl.get("spec", {})
            .get("containers", [{}])[0]
            .get("resources", {})
            .get("limits", {})
            or {}
        )
        cpu_s = lim.get("cpu") or "1"
        c = cpu_to_millicores(str(cpu_s))
        if max_i is None:
            rows.append((name, str(cpu_s), "?", -1))
            continue
        peak = c * max_i
        total += peak
        rows.append((name, str(cpu_s), str(max_i), peak))

    print(f"Région {region} — somme des pics (mCPU) ≈ {total}  (quota typique : 20_000)")
    print(f"{'Service':<32} {'CPU':<8} {'max':>5}  {'mCPU pic':>10}")
    for name, cpu_s, max_i, peak in sorted(rows, key=lambda r: r[0]):
        if max_i == "?":
            print(f"{name:<32} {cpu_s:<8} {'?':>5}  {'(max absent)':>10}")
        else:
            print(f"{name:<32} {cpu_s:<8} {max_i:>5}  {peak:>10}")

    if total > 20000:
        print(
            "\nLa somme dépasse 20_000 mCPU : baisse --max-instances (ou CPU) sur un ou plusieurs services,",
            file=sys.stderr,
        )
        print(
            "ou demande une hausse de quota « CpuAllocPerProjectRegion » :",
            "https://cloud.google.com/run/quotas",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
