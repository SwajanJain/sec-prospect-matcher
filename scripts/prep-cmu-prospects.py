#!/usr/bin/env python3
"""
Preprocess CMU prospect export into matcher-ready CSV.

Input:  Raw Karmabox/AlmaConnect export with fragmented address columns
Output: Clean CSV with columns matching @pm/core prospect-loader aliases

Edge cases handled:
- "City" column is 86% empty; "Location" has the real city (95% filled)
- "Permanent Add Street Line One" occasionally contains dates or bare numbers (all foreign)
- "Permanent Add Zip/Postal Code" includes ZIP+4 (kept as-is, normalizer handles it)
- ~1,700 international rows (Chinese provinces, etc.) → state cleared, kept for name matching
- 1 empty name → skipped
"""

import csv
import re
import sys

US_STATES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
    "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
    "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
    "DC", "PR", "VI", "GU", "AS", "MP",
}

OUT_COLUMNS = [
    "prospect_id",
    "name",
    "alias_names",
    "company",
    "other_companies",
    "address",
    "city",
    "state",
    "zip",
    "country",
    "title",
    "external_id",
]


def is_bad_street(value: str) -> bool:
    """Detect dates, bare numbers, and placeholder values in street field."""
    if not value:
        return False
    if re.match(r"^\d{1,2}/\d{1,2}/\d{2,4}$", value):
        return True
    if re.match(r"^\d{1,6}$", value):
        return True
    if value.upper() in ("YES", "NO", "N/A", "NA", "NONE", "UNKNOWN", "-", "--"):
        return True
    return False


def clean_state(value: str) -> str:
    """Return state only if it's a valid US 2-letter code."""
    s = value.strip().upper()
    return s if s in US_STATES else ""


def pick_city(city_col: str, location_col: str) -> str:
    """Prefer Location (95% filled) over City (14% filled)."""
    loc = location_col.strip()
    if loc:
        return loc
    return city_col.strip()


def main():
    input_path = sys.argv[1] if len(sys.argv) > 1 else "/Users/swajanjain/Downloads/prospect_bulk_69ce2c89a21ce000076903e7.csv"
    output_path = sys.argv[2] if len(sys.argv) > 2 else "data/cmu-prospects.csv"

    stats = {
        "total": 0,
        "written": 0,
        "skipped_no_name": 0,
        "street_cleaned": 0,
        "state_cleared_non_us": 0,
        "city_from_location": 0,
        "city_from_city_col": 0,
        "city_empty": 0,
    }

    with open(input_path, newline="", encoding="utf-8") as fin, \
         open(output_path, "w", newline="", encoding="utf-8") as fout:

        reader = csv.DictReader(fin)
        writer = csv.DictWriter(fout, fieldnames=OUT_COLUMNS)
        writer.writeheader()

        for row in reader:
            stats["total"] += 1
            name = row.get("Name", "").strip()
            if not name:
                stats["skipped_no_name"] += 1
                continue

            # Street
            street = row.get("Permanent Add Street Line One", "").strip()
            if is_bad_street(street):
                stats["street_cleaned"] += 1
                street = ""

            # City: prefer Location over City
            city_col = row.get("City", "").strip()
            location_col = row.get("Location", "").strip()
            city = pick_city(city_col, location_col)
            if city == location_col and location_col:
                stats["city_from_location"] += 1
            elif city == city_col and city_col:
                stats["city_from_city_col"] += 1
            else:
                stats["city_empty"] += 1

            # State
            raw_state = row.get("State", "").strip()
            state = clean_state(raw_state)
            if raw_state and not state:
                stats["state_cleared_non_us"] += 1

            # ZIP — keep as-is, normalizer handles ZIP+4
            zipcode = row.get("Permanent Add Zip/Postal Code", "").strip()

            # Country — derive from state presence
            country = "US" if state else ""

            writer.writerow({
                "prospect_id": row.get("prospect_id", "").strip(),
                "name": name,
                "alias_names": row.get("Alias Names", "").strip(),
                "company": row.get("Company Name", "").strip(),
                "other_companies": row.get("Other Companies", "").strip(),
                "address": street,
                "city": city,
                "state": state,
                "zip": zipcode,
                "country": country,
                "title": row.get("Title/Position", "").strip(),
                "external_id": row.get("crm_primary_id", "").strip(),
            })
            stats["written"] += 1

    print(f"Done: {stats['written']}/{stats['total']} rows written to {output_path}")
    print(f"  Skipped (no name): {stats['skipped_no_name']}")
    print(f"  Street cleaned (dates/numbers/placeholders): {stats['street_cleaned']}")
    print(f"  State cleared (non-US): {stats['state_cleared_non_us']}")
    print(f"  City from Location col: {stats['city_from_location']}")
    print(f"  City from City col: {stats['city_from_city_col']}")
    print(f"  City empty: {stats['city_empty']}")


if __name__ == "__main__":
    main()
