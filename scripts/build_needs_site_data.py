#!/usr/bin/env python3
"""Enrich needs.json with thumbnail URLs for the static needs site."""

import argparse
import json
from pathlib import Path


def normalized_identifier(value: object) -> str:
    value = str(value).strip()
    return value.lstrip("0") or "0"


def card_identifiers(card: dict[str, object]) -> set[str]:
    identifiers = {normalized_identifier(card["code"]), normalized_identifier(card["number"])}
    identifier = str(card.get("fullIdentifier", "")).split("/", maxsplit=1)[0]
    if identifier:
        identifiers.add(normalized_identifier(identifier))
    return identifiers


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("needs", type=Path, help="path to needs.json")
    parser.add_argument("all_cards", type=Path, help="path to allCards.json")
    parser.add_argument("output", type=Path, help="path for enriched cards.json")
    return parser.parse_args()


def main() -> None:
    arguments = parse_args()
    needs = json.loads(arguments.needs.read_text(encoding="utf-8"))
    all_cards = json.loads(arguments.all_cards.read_text(encoding="utf-8"))["cards"]

    enriched_cards = []
    missing_cards = []
    for needed_card in needs:
        card_number = needed_card["Card Number"].split(",", maxsplit=1)[0]
        set_code = normalized_identifier(needed_card["Set Number"])
        identifier = normalized_identifier(card_number)
        matches = [
            card
            for card in all_cards
            if normalized_identifier(card["setCode"]) == set_code
            and identifier in card_identifiers(card)
        ]
        card = next(
            (
                candidate
                for candidate in matches
                if candidate["fullName"].casefold() == needed_card["Name"].casefold()
            ),
            matches[0] if len(matches) == 1 else None,
        )
        if card is None:
            missing_cards.append(f"{needed_card['Name']} (set {set_code}, card {identifier})")
            continue

        enriched_cards.append(
            {
                **needed_card,
                "thumbnail": card["images"]["thumbnail"],
            }
        )

    if missing_cards:
        formatted_cards = "\n".join(f"  - {card}" for card in missing_cards)
        raise ValueError(f"Could not find image data for:\n{formatted_cards}")

    arguments.output.write_text(
        json.dumps(enriched_cards, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
