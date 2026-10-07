#!/usr/bin/env python3
"""Generate web seed data and Supabase import SQL from the reviewed manifest."""

import csv
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FIXTURES_DIR = ROOT / "fixtures" / "inventory"
MANIFEST = FIXTURES_DIR / "inventory_image_manifest.csv"
JSON_EXPORT = FIXTURES_DIR / "inventory.json"
SQL_OUTPUT = ROOT / "supabase" / "seed.sql"
EXPORT_OUTPUT = FIXTURES_DIR / "inventory.csv"


def sql_literal(value: str | int) -> str:
    if isinstance(value, int):
        return str(value)
    return "'" + value.replace("'", "''") + "'"


def normalized_location(location: str) -> str:
    if len(location) == 2 and location[1] == "?" and location[0] in "ABCD":
        return f"PENDING_{location[0]}"
    return location


def item_status(review_status: str) -> str:
    if review_status == "区域总览":
        return "overview"
    if review_status.startswith("待确认"):
        return "pending"
    return "confirmed"


def main() -> None:
    with MANIFEST.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    items = []
    for row in rows:
        image_path = row["新路径"]
        if not (ROOT / image_path).is_file():
            raise FileNotFoundError(f"Missing image for {row['编号']}: {image_path}")
        items.append(
            {
                "id": row["编号"],
                "name": row["物品名称"],
                "locationCode": normalized_location(row["位置"]),
                "quantity": "若干",
                "imagePath": "/" + image_path,
                "recognitionStatus": row["视觉识别状态"],
                "status": item_status(row["视觉识别状态"]),
                "sourceSequence": int(row["微信原序号"]),
                "createdAt": now,
                "updatedAt": now,
            }
        )

    json_text = json.dumps(items, ensure_ascii=False, indent=2) + "\n"
    JSON_EXPORT.write_text(json_text, encoding="utf-8")

    with EXPORT_OUTPUT.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["编号", "物品名称", "位置", "数量", "图片路径", "识别状态"],
        )
        writer.writeheader()
        for item in items:
            writer.writerow(
                {
                    "编号": item["id"],
                    "物品名称": item["name"],
                    "位置": item["locationCode"],
                    "数量": item["quantity"],
                    "图片路径": item["imagePath"],
                    "识别状态": item["recognitionStatus"],
                }
            )

    sql_lines = [
        "-- Generated from fixtures/inventory/inventory_image_manifest.csv.",
        "-- For an empty development database only: run schema_v2.sql first.",
        "-- Never reapply this seed to a live database; it overwrites inventory fields.",
        "",
        "INSERT INTO inventory_items",
        "  (id, name, location_code, quantity, image_path, recognition_status, source_sequence)",
        "VALUES",
    ]
    values = []
    for item in items:
        fields = (
            item["id"],
            item["name"],
            item["locationCode"],
            item["quantity"],
            item["imagePath"],
            item["recognitionStatus"],
            item["sourceSequence"],
        )
        values.append("  (" + ", ".join(sql_literal(field) for field in fields) + ")")
    sql_lines.append(",\n".join(values))
    sql_lines.extend(
        [
            "ON CONFLICT (id) DO UPDATE SET",
            "  name = EXCLUDED.name,",
            "  location_code = EXCLUDED.location_code,",
            "  quantity = EXCLUDED.quantity,",
            "  image_path = EXCLUDED.image_path,",
            "  recognition_status = EXCLUDED.recognition_status,",
            "  source_sequence = EXCLUDED.source_sequence;",
            "",
        ]
    )
    SQL_OUTPUT.write_text("\n".join(sql_lines), encoding="utf-8")
    print(f"Generated {len(items)} inventory records")


if __name__ == "__main__":
    main()
