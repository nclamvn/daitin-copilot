"""Extract local candidate text without evaluating or loading external content."""
import json
import sys
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "library"))
from ingest import extract

LIMIT = 12 * 1024 * 1024


class MailText(HTMLParser):
    excluded = {"script", "style", "head", "template"}
    breaks = {"p", "div", "li", "tr", "blockquote", "h1", "h2", "br"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text = []
        self.hidden = []

    def handle_starttag(self, tag, attrs):
        if tag in self.excluded:
            self.hidden.append(tag)
        if tag in self.breaks and not self.hidden:
            self.text.append("\n")

    def handle_endtag(self, tag):
        if self.hidden and self.hidden[-1] == tag:
            self.hidden.pop()
        if tag in self.breaks and not self.hidden:
            self.text.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.text.append(data)


data = sys.stdin.buffer.read(LIMIT + 1)
if not data or len(data) > LIMIT:
    raise ValueError("Dung lượng nguồn không hợp lệ.")
kind = sys.argv[1]
if kind not in ("word", "email"):
    raise ValueError("Chỉ đọc DOCX và EML.")
try:
    paragraphs = extract(data, kind)
except ValueError:
    if kind != "email":
        raise
    message = BytesParser(policy=policy.default).parsebytes(data)
    part = message.get_body(preferencelist=("html",))
    if part is None:
        raise
    parser = MailText()
    parser.feed(part.get_content())
    paragraphs = [line.strip() for line in "".join(parser.text).splitlines() if line.strip()]

if len(paragraphs) > 30_000 or sum(len(text) for text in paragraphs) > 4_000_000:
    raise ValueError("Nguồn vượt giới hạn phần văn bản.")
print(json.dumps(paragraphs, ensure_ascii=False))
