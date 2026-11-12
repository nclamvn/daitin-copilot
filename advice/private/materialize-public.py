"""Build pending DOCX review cards from captured, exact public evidence."""
import argparse
import hashlib
import json
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from subprocess import check_output
from xml.sax.saxutils import escape
from zipfile import ZipFile, ZIP_DEFLATED

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
CONTENT = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
REL = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def write_docx(path, lines):
    body = "".join("<w:p><w:r><w:t>" + escape(line) + "</w:t></w:r></w:p>" for line in lines)
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT)
        archive.writestr("_rels/.rels", REL)
        archive.writestr("word/document.xml", f'<w:document xmlns:w="{W}"><w:body>{body}</w:body></w:document>')


def prepare(captures, items):
    registry = json.loads((captures / "captures.json").read_text())
    prepared = []
    counts = {}
    for item in items:
        capture = registry[item["capture"]]
        if capture["url"] != item["origin"]:
            raise ValueError("CAPTURE_ORIGIN " + item["id"])
        file = captures / capture["file"]
        if hashlib.sha256(file.read_bytes()).hexdigest() != capture["sha256"]:
            raise ValueError("CAPTURE_HASH " + item["id"])
        if file.suffix == ".pdf":
            page = str(item["page"])
            text = check_output(["pdftotext", "-layout", "-f", page, "-l", page, str(file), "-"], timeout=12).decode()
        else:
            parser = Text()
            parser.feed(file.read_text(encoding="utf-8"))
            text = " ".join(parser.parts)
        excerpt = item["excerpt"]
        if excerpt not in " ".join(text.split()):
            raise ValueError("SPAN_NOT_FOUND " + item["id"])
        key = capture["resolved"]
        counts[key] = counts.get(key, 0) + len(excerpt.split())
        if counts[key] > 25:
            raise ValueError("QUOTE_LIMIT " + item["id"])
        prepared.append((item, capture))
    return prepared


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("captures", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    items = json.loads(Path(__file__).with_name("public-candidates.json").read_text())
    items = [item for item in items if not item.get("retired")]
    prepared = prepare(args.captures, items)
    if args.check:
        broken = [{**items[0], "excerpt": items[0]["excerpt"] + " ⟦injected⟧"}]
        try:
            prepare(args.captures, broken)
        except ValueError as error:
            if not str(error).startswith("SPAN_NOT_FOUND"):
                raise
        else:
            raise ValueError("Gate accepted a nonexistent span.")
        print(f"{len(prepared)} exact passages verified; injected span rejected.")
        return
    args.output.mkdir(parents=True, exist_ok=True)
    rows = []
    for item, capture in prepared:
        path = args.output / (item["id"] + ".docx")
        locator = item["locator"] + (f' · trang PDF {item["page"]}' if "page" in item else "")
        write_docx(path, [
            "Đoạn nguồn công khai · Chờ luật sư duyệt", item["owner"] + " · " + locator,
            item["excerpt"], "Diễn giải đề xuất · " + item["statement"], "Nguồn · " + capture["url"],
            "SHA-256 bản chụp · " + capture["sha256"], "Ngày đối chiếu bản chụp · " + date.today().isoformat(),
        ])
        rows.append({**item, "status": "pending", "file": path.name, "paragraph": 3, "origin": capture["url"],
                     "sourceSha256": capture["sha256"], "cardSha256": hashlib.sha256(path.read_bytes()).hexdigest()})
    (args.output / "queue.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n")
    print(f"Prepared {len(rows)} reviewed-for-extraction candidates awaiting legal approval.")


if __name__ == "__main__":
    main()
