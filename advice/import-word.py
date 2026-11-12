"""Extract the two reviewed POA passages into a private, digest-bound snapshot."""

import argparse
import hashlib
import io
import json
import os
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = "{" + NS["w"] + "}"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def private_output(path):
    parent = path.parent
    repo = Path(__file__).resolve().parent.parent
    if parent == repo or repo in parent.parents:
        raise ValueError("Chọn nơi lưu ảnh chụp nguồn bên ngoài kho mã.")
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if parent.stat().st_uid != os.getuid() or parent.stat().st_mode & 0o077:
        raise ValueError("Thư mục lưu nguồn phải do người chạy sở hữu, với quyền 0700.")


def extract(path, review):
    if path.stat().st_size > 30 * 1024 * 1024:
        raise ValueError("Tệp Word vượt giới hạn 30 MiB.")
    data = path.read_bytes()
    if review.get("schema") != 1 or review.get("wordSha256") != sha(data):
        raise ValueError("Tệp Word không khớp bản đã được đối chiếu.")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entry = archive.getinfo("word/document.xml")
        if entry.file_size > 24 * 1024 * 1024:
            raise ValueError("Nội dung Word vượt giới hạn 24 MiB.")
        xml = archive.read(entry)
    if b"<!DOCTYPE" in xml.upper():
        raise ValueError("Định dạng Word có khai báo XML không hỗ trợ.")
    body = ElementTree.fromstring(xml).find("w:body", NS)
    if body is None:
        raise ValueError("Không tìm được nội dung tài liệu.")
    rules = {rule["paragraph"]: rule for rule in review["sources"]}
    if len(rules) != 2:
        raise ValueError("Cần hai vị trí đã được đối chiếu.")
    sources = []
    for number, paragraph in enumerate(body.iter(W + "p"), 1):
        rule = rules.get(number)
        if rule is None:
            continue
        quote = "".join(node.text or "" for node in paragraph.iter(W + "t")).strip()
        digest = sha(quote.encode("utf-8"))
        if digest != rule["quoteSha256"]:
            raise ValueError(f"Đoạn Word {number} khác đoạn đã được đối chiếu.")
        sources.append({
            "id": rule["id"],
            "topic": rule["topic"],
            "paragraph": number,
            "quote": quote,
            "quoteSha256": digest,
        })
    if len(sources) != len(rules):
        raise ValueError("Không tìm đủ các đoạn Word đã được đối chiếu.")
    return {"schema": 1, "wordSha256": review["wordSha256"], "sources": sources}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("word", type=Path)
    parser.add_argument("review", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    destination = args.output.absolute()
    private_output(destination.resolve())
    if destination.is_symlink():
        raise ValueError("Dùng đường dẫn tệp thường cho ảnh chụp nguồn.")
    review = args.review.resolve(strict=True)
    private_output(review)
    if not review.is_file() or review.stat().st_mode & 0o077 or review.stat().st_uid != os.getuid():
        raise ValueError("Biên bản đối chiếu cần lưu riêng với quyền 0600.")
    snapshot = extract(args.word, json.loads(review.read_text(encoding="utf-8")))
    with tempfile.NamedTemporaryFile(dir=destination.parent, prefix=".import-", mode="w",
                                     encoding="utf-8", delete=False) as file:
        pending = Path(file.name)
        try:
            json.dump(snapshot, file, ensure_ascii=False, indent=2)
            file.write("\n")
            file.flush()
            os.fsync(file.fileno())
            os.replace(pending, destination)
        finally:
            pending.unlink(missing_ok=True)
    print("Đã khóa hai đoạn Word:", ", ".join(str(row["paragraph"]) for row in snapshot["sources"]))
    print("SHA-256:", snapshot["wordSha256"])


if __name__ == "__main__":
    main()
