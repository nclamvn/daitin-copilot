"""Verify manifest and extract exact approved DOCX and EML paragraphs."""

import argparse
import hashlib
import io
import json
import re
import zipfile
from email import policy
from email.parser import BytesParser
from pathlib import Path
from xml.etree import ElementTree

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def digest(value):
    return hashlib.sha256(value).hexdigest()


def extract(data, kind):
    if kind == "word":
        with zipfile.ZipFile(io.BytesIO(data)) as doc:
            part = doc.getinfo("word/document.xml")
            if part.file_size > 12 * 1024 * 1024:
                raise ValueError("XML Word vượt giới hạn.")
            xml = doc.read(part)
        if b"<!DOCTYPE" in xml.upper():
            raise ValueError("DOCX có khai báo XML không hỗ trợ.")
        body = ElementTree.fromstring(xml).find(W + "body")
        return ["".join(t.text or "" for t in p.iter(W + "t")).strip() for p in body.iter(W + "p")]
    message = BytesParser(policy=policy.default).parsebytes(data)
    part = message.get_body(preferencelist=("plain",))
    if part is None:
        raise ValueError("Email cần phần văn bản thuần.")
    return [s.strip() for s in re.split(r"\r?\n\s*\r?\n", part.get_content()) if s.strip()]


def build(manifest_path):
    root = manifest_path.parent.resolve()
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema") != 1 or manifest.get("simulation") is not True:
        raise ValueError("Gói pilot cần manifest đã gắn nhãn mô phỏng.")
    items = manifest["sources"]
    ids = {item["id"] for item in items}
    if not 1 <= len(items) == len(ids) <= 20_000:
        raise ValueError("Số nguồn ngoài giới hạn hoặc có mã trùng.")
    cache = {}
    rows = []
    for item in items:
        kind = item["kind"]
        path = (root / item["file"]).resolve(strict=True)
        if kind not in ("word", "email") or path.parent != root or path.suffix != (".docx" if kind == "word" else ".eml"):
            raise ValueError("Đường dẫn nguồn nằm ngoài gói hoặc sai loại.")
        if path.stat().st_size > 12 * 1024 * 1024:
            raise ValueError("Tệp nguồn vượt giới hạn.")
        if path not in cache:
            data = path.read_bytes()
            cache[path] = (digest(data), extract(data, kind))
        sha, paragraphs = cache[path]
        number = item["paragraph"]
        if sha != item["sha256"] or not 1 <= number <= len(paragraphs):
            raise ValueError("Sai dấu kiểm hoặc vị trí đoạn trong " + path.name)
        quote = paragraphs[number - 1]
        if not 12 <= len(quote) <= 2500 or paragraphs[0] != "TÀI LIỆU MÔ PHỎNG · CHỈ DÙNG NGHIỆM THU":
            raise ValueError("Đoạn nguồn vượt giới hạn hoặc thiếu nhãn mô phỏng.")
        rows.append(dict(item, quote=quote, quoteSha256=digest(quote.encode()), simulated=True))
    return {"schema": 1, "simulation": True, "rows": rows}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    index = build(args.manifest)
    temporary = args.output.with_suffix(".pending")
    try:
        temporary.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
        temporary.replace(args.output)
    finally:
        temporary.unlink(missing_ok=True)
    print("Đã khóa", len(index["rows"]), "đoạn từ Word và email.")
