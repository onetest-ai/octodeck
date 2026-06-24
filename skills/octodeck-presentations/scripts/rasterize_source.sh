#!/usr/bin/env bash
# Rasterize a source deck (PDF or PPTX) to one PNG per page so you can read it
# before recreating it in Octodeck. PPTX is converted to PDF via LibreOffice first.
#
# Usage: bash rasterize_source.sh <source.pdf|source.pptx> <outdir> [dpi]
# Requires: pdftoppm (poppler); soffice (LibreOffice) only for .pptx input.
set -euo pipefail

src="${1:?usage: rasterize_source.sh <source.pdf|pptx> <outdir> [dpi]}"
out="${2:?usage: rasterize_source.sh <source.pdf|pptx> <outdir> [dpi]}"
dpi="${3:-160}"

[ -f "$src" ] || { echo "error: no such file: $src" >&2; exit 1; }
command -v pdftoppm >/dev/null || { echo "error: pdftoppm not found (install poppler: brew install poppler)" >&2; exit 1; }

mkdir -p "$out"
ext="$(printf '%s' "${src##*.}" | tr '[:upper:]' '[:lower:]')"
pdf="$src"

if [ "$ext" = "pptx" ]; then
  command -v soffice >/dev/null || { echo "error: soffice not found (install LibreOffice) — needed to convert PPTX" >&2; exit 1; }
  echo "Converting PPTX → PDF via LibreOffice…"
  soffice --headless --convert-to pdf --outdir "$out" "$src" >/dev/null
  pdf="$out/$(basename "${src%.*}").pdf"
fi

pdftoppm -png -r "$dpi" "$pdf" "$out/page"
n="$(ls "$out"/page-*.png 2>/dev/null | wc -l | tr -d ' ')"
echo "Wrote $n page image(s) to $out/"
echo "Next: read every page, catalog each slide's archetype and the deck's"
echo "palette / fonts / motif, and strip any review annotations before rebuilding."
