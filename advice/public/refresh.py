"""Rebuild the chat supplement from the reviewed public-source snapshots."""
import argparse
import gzip
import hashlib
import html
import json
import re
import subprocess
from functools import cache
import unicodedata
from pathlib import Path
from urllib.parse import urlsplit

root = Path(__file__).resolve().parent
sha = lambda data: hashlib.sha256(data).hexdigest()


def normalize(text):
    return " ".join(unicodedata.normalize("NFC", text).split())


@cache
def extracted(path, page):
    data = path.read_bytes()
    if path.suffix == ".pdf":
        if not data.startswith(b"%PDF-") or not page:
            raise ValueError(f"Invalid PDF or page: {path}")
        return subprocess.check_output(["pdftotext", "-layout", "-f", str(page), "-l", str(page), str(path), "-"]).decode()
    if page:
        raise ValueError(f"HTML has no PDF page: {path}")
    raw = (gzip.decompress(data) if data.startswith(b"\x1f\x8b") else data).decode()
    if "<html" not in raw.lower() or len(data) < 3000:
        raise ValueError(f"Incomplete HTML: {path}")
    raw = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    return html.unescape(re.sub(r"<[^>]+>", " ", raw))


def build(policy, snapshots):
    output = []
    identifiers = set()
    for record in policy["records"]:
        source = policy["sources"][record["source"]]
        if record["id"] in identifiers or record["procedure"] != source["procedure"]:
            raise ValueError(f"Duplicate or wrong scope: {record['id']}")
        identifiers.add(record["id"])
        url = urlsplit(source["url"])
        if url.scheme != "https" or url.hostname not in policy["hosts"] or url.username or url.password:
            raise ValueError(f"Unapproved source: {url.hostname}")
        path = snapshots / source["file"]
        if path.parent != snapshots or path.is_symlink():
            raise ValueError(f"Invalid snapshot path: {path}")
        digest = sha(path.read_bytes())
        if digest != source["sha256"]:
            raise ValueError(f"Snapshot changed: {path.name}")
        quote = normalize(record["quote"])
        if quote not in normalize(extracted(path, record.get("page"))):
            raise ValueError(f"SPAN_NOT_FOUND: {record['id']}")
        output.append({**{k: v for k, v in record.items() if k not in ("source", "page", "quote")},
                       "quote": quote, "sourceSha256": digest, "quoteSha256": sha(quote.encode()),
                       "origin": source["url"], "title": source["title"], "issuer": source["issuer"],
                       "locator": record["locator"] + (f" · trang PDF {record['page']}" if record.get("page") else "")})
    return {"reviewedOn": policy["reviewedOn"], "records": output}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshots", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    policy = json.loads((root / "sources.json").read_text())
    packed = json.dumps(build(policy, args.snapshots), ensure_ascii=False, indent=2) + "\n"
    target = root / "index.json"
    if args.check:
        if target.read_text() != packed:
            raise SystemExit("Chat index differs from reviewed source policy.")
    else:
        target.write_text(packed)
    print("Verified", len(policy["records"]), "reviewed excerpts.")
