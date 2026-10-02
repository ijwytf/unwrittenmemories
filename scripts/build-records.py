"""Offline conversion: python scripts/build-records.py [source.xlsx]. Requires openpyxl.

Preserves all narrative cells verbatim; only comma-separated keywords are trimmed.
The browser loads data/records.json, never the workbook.
"""
import json
import sys
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "2차채록정리.xlsx"
workbook = openpyxl.load_workbook(source, read_only=True, data_only=False)
sheet = workbook.active
rows = sheet.iter_rows()
headers = [cell.value for cell in next(rows)]
expected = ["지역", "카테고리", "제목", "내용", "키워드"]
assert headers == expected, f"Unexpected columns: {headers}"
records = []
for row in rows:
    values = [cell.value for cell in row]
    if all(value is None for value in values):
        continue
    assert all(cell.data_type != "f" for cell in row), "Formula cells need explicit review"
    assert all(isinstance(value, str) for value in values), f"Incomplete record at row {row[0].row}"
    region, category, title, content, keywords = values
    records.append(dict(region=region, category=category, title=title, content=content,
                        keywords=[word.strip() for word in keywords.split(",") if word.strip()]))
workbook.close()
destination = ROOT / "data" / "records.json"
destination.parent.mkdir(exist_ok=True)
destination.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Converted {len(records)} records to {destination}")
