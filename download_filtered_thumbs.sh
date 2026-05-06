#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 path/to/setdata.N.json" >&2
  exit 1
fi

set_file="$1"

if [ ! -f "$set_file" ]; then
  echo "error: file not found: $set_file" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 1
fi

set_name="$(basename "$set_file")"
set_id="${set_name#setdata.}"
set_id="${set_id%.json}"
out_dir="public_html/images/set.${set_id}.thumbs"

mkdir -p "$out_dir"

jq -r '
  (if type == "array" then .[] else .cards[] end)
  | select(.rarity == "Common"
      or .rarity == "Uncommon"
      or .rarity == "Rare"
      or .rarity == "Super Rare"
      or .rarity == "Legendary")
  | [.id, .images.thumbnail]
  | @tsv
' "$set_file" |
while IFS=$'\t' read -r card_id url; do
  [ -n "$card_id" ] || continue
  [ -n "$url" ] || continue
  out_file="$out_dir/${card_id}.jpg"
  if [ -f "$out_file" ]; then
    continue
  fi
  curl -fsSL "$url" -o "$out_file"
done

echo "Downloaded thumbnails to $out_dir"
