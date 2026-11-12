"""Capture the public primary and institutional URLs used in the M11 review queue."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
from subprocess import check_output
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

SOURCES = {
    "vn-cong-bao": "https://ipvietnam.gov.vn/documents/20195/2433971/2026_306_20_2026_TT-BKHCN.pdf/f8e65a02-7e75-480e-ad94-32970d57ed60",
    "vn-vbhn": "https://datafiles.chinhphu.vn/cpp/files/vbpq/2026/7/06-vbhn-bkhcn.signed.pdf",
    "th-pct": "https://pctlegal.wipo.int/eGuide/view-doc.xhtml?doc-code=TH&doc-lang=en",
    "th-wipo": "https://pctlegal.wipo.int/eGuide/eqe/view-doc.xhtml?doc-code=TH&doc-lang=EN&doc-type=annex",
    "sg-ops": "https://www.ipos.gov.sg/about-ip/trade-marks/managing-trade-marks/managing-trade-marks-overview/",
    "sg-fee": "https://www.ipos.gov.sg/about-ip/trade-marks/forms-and-fees/",
    "sg-patent": "https://www.ipos.gov.sg/about-ip/patents/managing-patents/renew-restore-patents/",
    "my-law": "https://www.wipo.int/wipolex/en/text/547329",
    "my-pct": "https://pctlegal.wipo.int/eGuide/view-doc.xhtml?doc-code=MY&doc-lang=en",
}
LIMIT = 15 * 1024 * 1024


class SameHost(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old, new = urlparse(req.full_url), urlparse(newurl)
        if new.scheme != "https" or new.hostname != old.hostname or new.username or new.password:
            raise ValueError("Redirect outside authorized source.")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(item):
    name, url = item
    if name == "vn-cong-bao":
        data = check_output(["curl", "--proto", "=https", "--silent", "--show-error", "--fail",
                             "--max-time", "23", "--max-filesize", str(LIMIT), url], timeout=25)
        resolved = url
    else:
        with build_opener(SameHost).open(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=23) as res:
            data = res.read(LIMIT + 1)
            resolved = res.geturl()
    pdf = url.endswith(".pdf") or name == "vn-cong-bao"
    if len(data) > LIMIT or not data or (pdf and not data.startswith(b"%PDF-")):
        raise ValueError("Unexpected size or format for " + name)
    return name, data, {"url": url, "resolved": resolved, "bytes": len(data),
                        "file": name + (".pdf" if pdf else ".html"), "sha256": hashlib.sha256(data).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("new_capture_directory", type=Path)
    args = parser.parse_args()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        captured = list(pool.map(fetch, SOURCES.items()))
    args.new_capture_directory.mkdir(parents=True, exist_ok=False)
    manifest = {}
    for name, data, meta in captured:
        (args.new_capture_directory / meta["file"]).write_bytes(data)
        manifest[name] = meta
    (args.new_capture_directory / "captures.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Captured", len(manifest), "sources.")
