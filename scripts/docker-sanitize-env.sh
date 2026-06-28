#!/usr/bin/env bash
# Rend un fichier .env compatible docker run / docker compose (--env-file).
# Corrige : espaces autour de =, clés avec espaces, séparateurs numériques 3_000.
#
# Usage :
#   ./scripts/docker-sanitize-env.sh .env.docker
#   ./scripts/docker-sanitize-env.sh .env.docker -o .env.docker.runtime
set -euo pipefail

INPUT="${1:?fichier .env requis}"
OUTPUT="${INPUT}"
shift

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) OUTPUT="${2:?}"; shift 2 ;;
    *) echo "Option inconnue : $1" >&2; exit 1 ;;
  esac
done

[[ -f "${INPUT}" ]] || { echo "Fichier absent : ${INPUT}" >&2; exit 1; }

python3 - "${INPUT}" "${OUTPUT}" <<'PY'
import re
import sys
from pathlib import Path

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
out_lines = []
for raw in src.read_text(encoding="utf-8").splitlines():
    line = raw.rstrip("\n")
    if not line.strip() or line.lstrip().startswith("#"):
        out_lines.append(line)
        continue
    m = re.match(r"^(\s*export\s+)?([^=+#]+?)\s*=\s*(.*)$", line)
    if not m:
        out_lines.append(line)
        continue
    export, key, val = m.group(1) or "", m.group(2).strip(), m.group(3)
    val = val.strip()
    if re.fullmatch(r"\d[\d_]*", val):
        val = val.replace("_", "")
    out_lines.append(f"{export}{key}={val}")

dst.write_text("\n".join(out_lines) + ("\n" if out_lines else ""), encoding="utf-8")
print(f"OK — {dst} ({len(out_lines)} lignes)")
PY
