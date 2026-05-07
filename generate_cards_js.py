#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path


ALLOWED_RARITIES = {"Common", "Uncommon", "Rare", "Super Rare", "Legendary"}
SETDATA_RE = re.compile(r"^setdata\.(.+)\.json$")
PAR_BY_COST = {1: 5, 2: 7, 3: 9, 4: 11, 5: 14, 6: 16, 7: 19}
BUILTIN_VIEW_LABELS = {"Items", "Songs", "Actions", "Locations", "Uninkable"}
EXCLUDED_GENERATED_SUBTYPE_VIEWS = {"Song"}


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
    baseline = PAR_BY_COST.get(cost)
    if baseline is None:
        return None

    basic_value = int(card["strength"]) + int(card["willpower"]) + (2 * int(card["lore"]) - 1)
    return basic_value - baseline


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def ability_text(card: dict) -> str:
    parts: list[str] = []
    for ability in card.get("abilities") or []:
        if not isinstance(ability, dict):
            continue
        for key in ("effect", "fullText", "name", "keyword"):
            value = ability.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value)

    full_text = card.get("fullText")
    if isinstance(full_text, str) and full_text.strip():
        parts.append(full_text)

    return normalize_whitespace("\n".join(parts))


def pluralize(word: str) -> str:
    lower = word.lower()
    if lower.endswith(("s", "x", "z", "ch", "sh")):
        return word + "es"
    if lower.endswith("y") and len(word) > 1 and lower[-2] not in "aeiou":
        return word[:-1] + "ies"
    if lower.endswith("o"):
        return word + "es"
    return word + "s"


def subtype_variants(subtype: str) -> set[str]:
    normalized = normalize_whitespace(subtype)
    variants = {normalized}
    if not re.fullmatch(r"[A-Za-z]+(?: [A-Za-z]+)*", normalized):
        return variants

    words = normalized.split(" ")
    words[-1] = pluralize(words[-1])
    variants.add(" ".join(words))
    return variants


def subtype_pattern(subtype: str) -> re.Pattern[str]:
    variant_patterns = []
    for variant in subtype_variants(subtype):
        words = normalize_whitespace(variant).split(" ")
        variant_patterns.append(r"(?<![a-z0-9])" + r"\s+".join(re.escape(word) for word in words) + r"(?![a-z0-9])")
    return re.compile("|".join(variant_patterns), re.IGNORECASE)


def analyze_subtypes(cards: list[dict]) -> tuple[dict[str, set[str]], list[dict]]:
    subtype_counts: Counter[str] = Counter()
    for card in cards:
        subtype_counts.update(card.get("subtypes") or [])

    subtype_patterns = {subtype: subtype_pattern(subtype) for subtype in subtype_counts}
    mentioned_by_subtype: dict[str, set[str]] = defaultdict(set)

    for card in cards:
        text = ability_text(card)
        if not text:
            continue
        card_id = str(card.get("id"))
        for subtype, pattern in subtype_patterns.items():
            if pattern.search(text):
                mentioned_by_subtype[subtype].add(card_id)

    subtype_views = []
    for subtype in sorted(mentioned_by_subtype):
        count = subtype_counts[subtype]
        if count <= 10 or subtype in EXCLUDED_GENERATED_SUBTYPE_VIEWS:
            continue

        label = subtype if subtype not in BUILTIN_VIEW_LABELS else f"{subtype} Subtype"
        subtype_views.append(
            {
                "key": f"filter:subtype:{slugify(subtype)}",
                "label": label,
                "subtype": subtype,
                "type": "filter",
                "cardCount": count,
            }
        )

    qualifying_subtypes = {view["subtype"] for view in subtype_views}
    qualifying_mentions = {
        subtype: card_ids
        for subtype, card_ids in mentioned_by_subtype.items()
        if subtype in qualifying_subtypes
    }
    return qualifying_mentions, subtype_views


def build_entries(
    cards: list[dict], set_id: str, thumb_dir: Path, qualifying_mentions: dict[str, set[str]]
) -> tuple[list[dict], list[tuple[int, str]]]:
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
        card_id_str = str(card_id)
        mentioned_subtypes = sorted(
            subtype for subtype, card_ids in qualifying_mentions.items()
            if card_id_str in card_ids
        )
        entries.append(
            {
                "id": card_id_str,
                "number": card.get("number"),
                "name": card.get("fullName") or card.get("name") or f"Card {card_id}",
                "type": card.get("type"),
                "subtypes": card.get("subtypes") or [],
                "mentionedSubtypes": mentioned_subtypes,
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
    root = Path(__file__).resolve().parent
    output_file = (
        Path(sys.argv[2]).expanduser().resolve()
        if len(sys.argv) == 3
        else root / "docs" / "tiersite" / "cards.js"
    )
    thumb_dir = root / "docs" / "images" / f"set.{set_id}.thumbs"
    if not thumb_dir.is_dir():
        print(f"error: thumbnail directory not found: {thumb_dir}", file=sys.stderr)
        return 1

    cards = load_cards(set_file)
    qualifying_mentions, subtype_views = analyze_subtypes(cards)
    entries, missing = build_entries(cards, set_id, thumb_dir, qualifying_mentions)

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(
        "window.LORCANA_SET12_CARDS = "
        + json.dumps(entries, indent=2)
        + ";\nwindow.LORCANA_SET12_SUBTYPE_VIEWS = "
        + json.dumps(subtype_views, indent=2)
        + ";\n"
    )

    counts = Counter(card["costBucket"] for card in entries)
    ordered_counts = dict(sorted(counts.items(), key=lambda kv: (99 if kv[0] == "7+" else int(kv[0]))))
    print(f"wrote {len(entries)} cards to {output_file}")
    print(f"buckets: {ordered_counts}")
    if subtype_views:
        print("subtype views:", ", ".join(f"{view['label']} ({view['cardCount']})" for view in subtype_views))
    if missing:
        print(f"skipped {len(missing)} cards with missing thumbnails", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
