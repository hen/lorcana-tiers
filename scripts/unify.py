#!/usr/bin/env python3
"""Normalize a card collection CSV by combining matching name/set rows."""

import argparse
import csv
import json
import sys
from collections import OrderedDict
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "input",
        nargs="?",
        type=Path,
        help="source CSV file",
    )
    parser.add_argument(
        "output",
        nargs="?",
        type=Path,
        help="normalized output file",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="write normalized records as JSON instead of CSV",
    )
    arguments = parser.parse_args()
    if arguments.input is None or arguments.output is None:
        print(
            "warning: both an input filename and an output filename are required.",
            file=sys.stderr,
        )
        parser.print_usage(sys.stderr)
        parser.exit(2)
    return arguments


def unique_append(values: list[str], value: str) -> None:
    if value and value not in values:
        values.append(value)


def normalize(input_path: Path) -> tuple[list[str], list[dict[str, object]]]:
    with input_path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        if reader.fieldnames is None:
            raise ValueError("The input CSV has no header row.")

        required_fields = {"Set Number", "Name", "Count", "Card Number", "Rarity"}
        missing_fields = required_fields - set(reader.fieldnames)
        if missing_fields:
            raise ValueError(
                f"Missing required column(s): {', '.join(sorted(missing_fields))}"
            )

        output_fields = [field for field in reader.fieldnames if field != "Variant"]
        groups: OrderedDict[tuple[str, str], dict[str, object]] = OrderedDict()

        for row_number, row in enumerate(reader, start=2):
            key = (row["Name"], row["Set Number"])
            try:
                count = int(row["Count"])
            except ValueError as error:
                raise ValueError(
                    f"Invalid Count on row {row_number}: {row['Count']!r}"
                ) from error

            if key not in groups:
                groups[key] = {
                    "row": {field: row[field] for field in output_fields},
                    "count": count,
                    "card_numbers": [row["Card Number"]],
                    "rarities": [row["Rarity"]] if row["Rarity"] else [],
                }
                continue

            group = groups[key]
            group["count"] = int(group["count"]) + count
            group["card_numbers"].append(row["Card Number"])
            unique_append(group["rarities"], row["Rarity"])

        normalized_rows = []
        for group in groups.values():
            normalized_row = group["row"]
            normalized_row["Count"] = group["count"]
            normalized_row["Card Number"] = ",".join(group["card_numbers"])
            normalized_row["Rarity"] = ",".join(group["rarities"])
            if normalized_row["Count"] >= 4:
                continue
            if normalized_row["Rarity"] in {"Promo", "Epic"}:
                continue
            normalized_row["Count"] = 4 - normalized_row["Count"]
            normalized_rows.append(normalized_row)

    return output_fields, normalized_rows


def write_csv(
    output_path: Path, output_fields: list[str], normalized_rows: list[dict[str, object]]
) -> None:
    with output_path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=output_fields)
        writer.writeheader()
        writer.writerows(normalized_rows)


def write_json(output_path: Path, normalized_rows: list[dict[str, object]]) -> None:
    with output_path.open("w", encoding="utf-8") as destination:
        json.dump(normalized_rows, destination, indent=2)
        destination.write("\n")


if __name__ == "__main__":
    arguments = parse_args()
    fields, rows = normalize(arguments.input)
    if arguments.json:
        write_json(arguments.output, rows)
    else:
        write_csv(arguments.output, fields, rows)
