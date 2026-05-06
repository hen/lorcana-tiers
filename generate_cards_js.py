#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path


ALLOWED_RARITIES = {"Common", "Uncommon", "Rare", "Super Rare", "Legendary"}
SETDATA_RE = re.compile(r"^setdata\.(.+)\.json$")
PAR_BY_COST = {1: 5, 2: 7, 3: 9, 4: 11, 5: 14, 6: 16, 7: 19}


def parse_set_id(set_file: Path) -> str:
    match = SETDATA_RE.match(set_file.name)
    if not match:
      raise SystemExit(f"error: expected a file named like setdata.N.json, got {set_file.name}")
    return match.group(1)


def load_cards(set_file: Path) -> list[dict]:
    with set_file.open() as handle:
        data = json.load(handle)

    if isinstance(data, dict) and isinstance(data.get("cards"), list):
        cards = data["cards"]
    elif isinstance(data, list):
        cards = data
    else:
        raise SystemExit(f"error: could not find a cards array in {set_file}")

    return [card for card in cards if isinstance(card, dict)]


def compute_par_delta(card: dict) -> int | None:
    if not all(isinstance(card.get(key), int) for key in ("strength", "willpower", "lore", "cost")):
        return None

    cost = int(card["cost"])
    baseline = PAR_BY_COST.get(min(cost, 7))
    if baseline is None:
        return None

    basic_value = int(card["strength"]) + int(card["willpower"]) + (2 * int(card["lore"]) - 1)
    return basic_value - baseline


def build_entries(cards: list[dict], set_id: str, thumb_dir: Path) -> tuple[list[dict], list[tuple[int, str]]]:
    entries: list[dict] = []
    missing: list[tuple[int, str]] = []

    for card in cards:
        if card.get("rarity") not in ALLOWED_RARITIES:
            continue

        card_id = card.get("id")
        if card_id is None:
            continue

        thumb_path = thumb_dir / f"{card_id}.jpg"
        if not thumb_path.exists():
            missing.append((card_id, card.get("fullName") or card.get("name") or f"Card {card_id}"))
            continue

        cost = card.get("cost")
        cost_bucket = "7+" if isinstance(cost, int) and cost >= 7 else str(cost)
        par_delta = compute_par_delta(card)
        entries.append(
            {
                "id": str(card_id),
                "number": card.get("number"),
                "name": card.get("fullName") or card.get("name") or f"Card {card_id}",
                "type": card.get("type"),
                "subtypes": card.get("subtypes") or [],
                "rarity": card.get("rarity"),
                "story": card.get("story"),
                "cost": cost,
                "costBucket": cost_bucket,
                "inkwell": card.get("inkwell"),
                "parDelta": par_delta,
                "thumbnail": f"../images/set.{set_id}.thumbs/{card_id}.jpg",
            }
        )

    entries.sort(
        key=lambda card: (
            card["number"],
            card["id"],
        )
    )
    return entries, missing


def main() -> int:
    if len(sys.argv) not in {2, 3}:
        print("usage: generate_cards_js.py path/to/setdata.N.json [output_file]", file=sys.stderr)
        return 1

    set_file = Path(sys.argv[1]).expanduser().resolve()
    if not set_file.is_file():
        print(f"error: file not found: {set_file}", file=sys.stderr)
        return 1

    set_id = parse_set_id(set_file)
    root = set_file.parent
    output_file = (
        Path(sys.argv[2]).expanduser().resolve()
        if len(sys.argv) == 3
        else root / "public_html" / "tiersite" / "cards.js"
    )
    thumb_dir = root / "public_html" / "images" / f"set.{set_id}.thumbs"
    if not thumb_dir.is_dir():
        print(f"error: thumbnail directory not found: {thumb_dir}", file=sys.stderr)
        return 1

    cards = load_cards(set_file)
    entries, missing = build_entries(cards, set_id, thumb_dir)

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text("window.LORCANA_SET12_CARDS = " + json.dumps(entries, indent=2) + ";\n")

    counts = Counter(card["costBucket"] for card in entries)
    ordered_counts = dict(sorted(counts.items(), key=lambda kv: (99 if kv[0] == "7+" else int(kv[0]))))
    print(f"wrote {len(entries)} cards to {output_file}")
    print(f"buckets: {ordered_counts}")
    if missing:
        print(f"skipped {len(missing)} cards with missing thumbnails", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
