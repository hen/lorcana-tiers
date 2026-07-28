#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ALLOWED_RARITIES = {"Common", "Uncommon", "Rare", "Super Rare", "Legendary"}
SETDATA_RE = re.compile(r"^setdata\.(\d+)\.json$")
EARLY_SET_PAR_BY_COST = {1: 5, 2: 6, 3: 8, 4: 9, 5: 12, 6: 14, 7: 16, 8: 19}
CURRENT_PAR_BY_COST = {1: 5, 2: 7, 3: 9, 4: 11, 5: 14, 6: 16, 7: 19}
BUILTIN_VIEW_LABELS = {"Items", "Songs", "Actions", "Locations", "Uninkable"}
EXCLUDED_GENERATED_SUBTYPE_VIEWS = {"Song"}


def parse_set_id(set_file: Path) -> str:
    match = SETDATA_RE.match(set_file.name)
    if not match:
        raise SystemExit(f"error: expected a file named like setdata.N.json, got {set_file.name}")
    return match.group(1)


def parse_number(value: object, fallback: int) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return fallback


def iter_candidate_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if path.is_dir():
        return sorted(candidate for candidate in path.iterdir() if candidate.is_file() and candidate.name.startswith("setdata."))
    raise SystemExit(f"error: path not found: {path}")


def discover_set_files(args: list[str]) -> list[Path]:
    input_args = args or ["."]
    discovered: dict[Path, Path] = {}

    for raw_arg in input_args:
        base = Path(raw_arg).expanduser().resolve()
        for candidate in iter_candidate_files(base):
            match = SETDATA_RE.match(candidate.name)
            if base.is_file() and not match:
                raise SystemExit(f"error: expected a numeric setdata file, got {candidate.name}")
            if match:
                discovered[candidate.resolve()] = candidate.resolve()

    if not discovered:
        raise SystemExit("error: no numeric setdata.N.json files found")

    return sorted(discovered.values(), key=lambda file_path: int(parse_set_id(file_path)))


def load_set_document(set_file: Path) -> object:
    with set_file.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_cards(data: object, set_file: Path) -> list[dict]:
    if isinstance(data, dict) and isinstance(data.get("cards"), list):
        cards = data["cards"]
    elif isinstance(data, list):
        cards = data
    else:
        raise SystemExit(f"error: could not find a cards array in {set_file}")

    return [card for card in cards if isinstance(card, dict)]


def compute_par_delta(card: dict, set_number: int) -> int | None:
    if not all(isinstance(card.get(key), int) for key in ("strength", "willpower", "lore", "cost")):
        return None

    cost = int(card["cost"])
    is_early_set = 1 <= set_number <= 9
    baseline = (EARLY_SET_PAR_BY_COST if is_early_set else CURRENT_PAR_BY_COST).get(cost)
    if baseline is None:
        return None

    if is_early_set:
        basic_value = int(card["strength"]) + int(card["willpower"]) + int(card["lore"])
    else:
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


def analysis_abilities(card: dict) -> list[dict[str, str]]:
    abilities: list[dict[str, str]] = []
    for ability in card.get("abilities") or []:
        if not isinstance(ability, dict):
            continue
        entry = {
            key: value
            for key in ("keyword", "effect")
            if isinstance((value := ability.get(key)), str) and value.strip()
        }
        if entry:
            abilities.append(entry)
    return abilities


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


def resolve_thumbnail(card: dict, set_id: str, thumb_dir: Path | None) -> tuple[str | None, str]:
    card_id = card.get("id")
    if card_id is None:
        return None, "missing"

    if thumb_dir is not None:
        local_thumb = thumb_dir / f"{card_id}.jpg"
        if local_thumb.is_file():
            return f"../images/set.{set_id}.thumbs/{card_id}.jpg", "local"

    remote_thumb = card.get("images", {}).get("thumbnail") if isinstance(card.get("images"), dict) else None
    if isinstance(remote_thumb, str) and remote_thumb.strip():
        return remote_thumb, "remote"

    return None, "missing"


def build_entries(
    cards: list[dict], set_id: str, thumb_dir: Path | None, qualifying_mentions: dict[str, set[str]]
) -> tuple[list[dict], list[tuple[int | str, str]], Counter[str]]:
    entries: list[dict] = []
    missing: list[tuple[int | str, str]] = []
    thumbnail_sources: Counter[str] = Counter()
    set_number = int(set_id)

    for card in cards:
        if card.get("rarity") not in ALLOWED_RARITIES:
            continue

        card_id = card.get("id")
        if card_id is None:
            continue

        thumbnail, thumbnail_source = resolve_thumbnail(card, set_id, thumb_dir)
        if thumbnail is None:
            missing.append((card_id, card.get("fullName") or card.get("name") or f"Card {card_id}"))
            continue

        thumbnail_sources[thumbnail_source] += 1
        cost = card.get("cost")
        cost_bucket = "7+" if isinstance(cost, int) and cost >= 7 else str(cost)
        par_delta = compute_par_delta(card, set_number)
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
                "fullText": card.get("fullText") or "",
                "abilities": analysis_abilities(card),
                "rarity": card.get("rarity"),
                "story": card.get("story"),
                "cost": cost,
                "costBucket": cost_bucket,
                "inkwell": card.get("inkwell"),
                "parDelta": par_delta,
                "thumbnail": thumbnail,
            }
        )

    entries.sort(
        key=lambda card: (
            card["number"] if isinstance(card["number"], int) else 9999,
            card["id"],
        )
    )
    return entries, missing, thumbnail_sources


def build_set_meta(data: object, set_file: Path, card_count: int) -> dict:
    set_id = parse_set_id(set_file)
    set_number = parse_number(data.get("number"), int(set_id)) if isinstance(data, dict) else int(set_id)
    set_name = data.get("name") if isinstance(data, dict) and isinstance(data.get("name"), str) else f"Set {set_number}"
    set_code = data.get("code") if isinstance(data, dict) and isinstance(data.get("code"), str) else str(set_number)
    release_date = data.get("releaseDate") if isinstance(data, dict) else None
    prerelease_date = data.get("prereleaseDate") if isinstance(data, dict) else None

    return {
        "id": str(set_number),
        "number": set_number,
        "code": set_code,
        "name": set_name,
        "releaseDate": release_date,
        "prereleaseDate": prerelease_date,
        "cardCount": card_count,
        "asset": f"data/set.{set_number}.js",
    }


def write_set_asset(data_dir: Path, set_id: str, payload: dict) -> Path:
    output_file = data_dir / f"set.{set_id}.js"
    output_file.write_text(
        "window.LORCANA_TIER_SITE_SETS = window.LORCANA_TIER_SITE_SETS || {};\n"
        + f"window.LORCANA_TIER_SITE_SETS[{json.dumps(set_id)}] = "
        + json.dumps(payload, indent=2, ensure_ascii=False)
        + ";\n",
        encoding="utf-8",
    )
    return output_file


def write_manifest(data_dir: Path, manifest: dict) -> Path:
    output_file = data_dir / "manifest.js"
    output_file.write_text(
        "window.LORCANA_TIER_SITE_MANIFEST = "
        + json.dumps(manifest, indent=2, ensure_ascii=False)
        + ";\n",
        encoding="utf-8",
    )
    return output_file


def should_include_set(data: object, set_file: Path) -> bool:
    if not isinstance(data, dict):
        return True
    set_type = data.get("type")
    set_number = parse_number(data.get("number"), int(parse_set_id(set_file)))
    return set_type == "expansion" and set_number > 0


def main() -> int:
    set_files = discover_set_files(sys.argv[1:])
    root = Path(__file__).resolve().parent
    data_dir = root / "docs" / "tiersite" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    manifest_sets: list[dict] = []
    summaries: list[str] = []
    generated_ids: set[str] = set()

    for set_file in set_files:
        data = load_set_document(set_file)
        if not should_include_set(data, set_file):
            continue

        set_id = parse_set_id(set_file)
        cards = load_cards(data, set_file)
        thumb_dir_candidate = root / "docs" / "images" / f"set.{set_id}.thumbs"
        thumb_dir = thumb_dir_candidate if thumb_dir_candidate.is_dir() else None
        qualifying_mentions, subtype_views = analyze_subtypes(cards)
        entries, missing, thumbnail_sources = build_entries(cards, set_id, thumb_dir, qualifying_mentions)
        meta = build_set_meta(data, set_file, len(entries))
        payload = {
            "meta": meta,
            "cards": entries,
            "subtypeViews": subtype_views,
        }

        write_set_asset(data_dir, meta["id"], payload)
        manifest_sets.append(meta)
        generated_ids.add(meta["id"])

        thumbnail_summary = []
        if thumbnail_sources.get("local"):
            thumbnail_summary.append(f"{thumbnail_sources['local']} local")
        if thumbnail_sources.get("remote"):
            thumbnail_summary.append(f"{thumbnail_sources['remote']} remote")
        if not thumbnail_summary:
            thumbnail_summary.append("0 thumbnails")

        summaries.append(
            f"set {meta['number']}: {meta['name']} -> {len(entries)} cards, "
            + ", ".join(thumbnail_summary)
            + (f", skipped {len(missing)} missing thumbnails" if missing else "")
        )

    if not manifest_sets:
        print("error: no expansion setdata.N.json files were eligible for generation", file=sys.stderr)
        return 1

    manifest_sets.sort(key=lambda item: item["number"])
    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "defaultSetId": manifest_sets[-1]["id"],
        "sets": manifest_sets,
    }
    write_manifest(data_dir, manifest)

    for stale_file in data_dir.glob("set.*.js"):
        match = re.fullmatch(r"set\.(\d+)\.js", stale_file.name)
        if match and match.group(1) not in generated_ids:
            stale_file.unlink()

    print(f"wrote manifest and {len(manifest_sets)} set assets to {data_dir}")
    for summary in summaries:
        print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
