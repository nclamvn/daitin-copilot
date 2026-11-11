# Patent evidence seed, M6

This is a **candidate evidence dataset**, not Đại Tín's approved legal SOT. Its value is actual source text, real patent claims, saved original files and reproducible evidence spans. No lawyer has approved its semantics. Publication of a patent is not a conclusion about enforceable rights, novelty, ownership, family membership, infringement or FTO.

## Frozen capture scope

The current catalog contains 43 sources, 1,874 exact-span records and 17 genuine patent publication specimens. Patent claim text comprises 99 source-native English XML claims from six EPO publications, plus 37 unreviewed OCR claim candidates from two official Vietnamese patent PDFs. Four other EPO XML responses contain bibliographic data without claim text. Four PDF specimens have unextracted image-body claims; their available native cover/abstract text is separately indexed. The corpus is deliberately incomplete. All37 OCR claims remain unverified; two distinct known damaged cases (VN47032 technical wording/unit and VN42110 claim1 page furniture) have explicit block flags. The corpus is not ready for legal SOT promotion.

Source roles are explicit: 8 Vietnamese legal versions, 11 official guidance sources, 17 patent publications, 4 access-policy documents and 3 Đại Tín company-authored secondary sources. Existing law snapshots are referenced in place, never duplicated. New raw captures occupy about21MiB; the entire new data directory is about31MiB, below the40MiB deployment target and150MiB capture ceiling. No private client file, PATENTSCOPE search result, credential or inferred legal-status database is included.

The seed represents coating/electronics, antennas, mobile communications, knitting machinery, microparticles, microbial fuel cells, recording materials, additive manufacturing and packaging/labels. This is practice-relevant breadth, not measured coverage of Đại Tín's caseload.

## Evidence contract

`catalog.json` is the runtime manifest. Every source binds its saved original through `sha256`, saved extraction through `textSHA256`, role, jurisdiction, actual capture time or explicitly unknown original capture time, source version and review status. `discoveryUrl` records the exact discovered source page/endpoint, not an invented independent corroboration. EPO publication IDs and dates come from source XML attributes. Vietnamese bibliographic titles/application numbers/publication dates are parsed from native INID(54)/(21)/(45) PDF cover text. These are publication facts, not current-rights conclusions.

Each record has an exact UTF-16 `locator.start/end` into the saved extraction, a separate `evidenceSHA256`, original URL and PDF page/XML claim locator. Exact spans prove that the excerpt is unchanged from the saved extraction. They do not prove that OCR reproduced the original correctly. XML whitespace and HTML markup are normalized by the recorded deterministic extractor; OCR text is saved verbatim in separately hashed receipts.

All `humanReview` fields are null. Primary official material has `captured_primary`; company commentary has `secondary`. Neither means lawyer approval. Unknown effective dates, legal status and family relations remain null. Consolidations do not independently enact their entire text. The2026 consolidation includes notes about a future2027 law; the2025 consolidation and company2024/2025 notes remain historical. Article-specific commencement, transitional rules and applicability require legal review.

Claim dependencies are **literal numeric references**, not a legal dependency classification. Explicit numeric ranges expand deterministically, `or` alternatives remain numeric references, and unnumbered “preceding claims” remain unresolved. EP2000000A1 claim8 literally says “claims5-37”, an apparent source anomaly: exact text remains, dependencies are null and a coverage gap is recorded. No correction was invented.

## Known extraction limitations

- VN47032 PDF page18 (printed16) has a visually confirmed OCR error involving “mạch thẳng” and theμm unit glyph. The OCR is unchanged, `requiresOriginalCheck=true`, and `knownExtractionWarning` is carried to the product. Hash/span success is not OCR accuracy. This source requires checking the original before using affected evidence in analysis or approval.
- VN42110 claim1 crosses PDF pages16-17. Visual review confirmed page-boundary contamination inside the claim (standalone ae and page-header 42 110 interrupt its sentence). This record has knownExtractionWarning and requiresOriginalCheck=true and must be blocked from AI analysis/approval until a separately reviewed corrected version is published. Its exact-span OCR remains unchanged. The other claims from this source remain unreviewed, with no claim of accuracy.
- US5783810 technical evidence uses OCR from the official USPTO PDF. Two-column reading order, units and numerals require checking against the original. No source-native US claim text is claimed.
- VN42036/VN42158 and US10000000/US6368227 retain image-only claim gaps. Four EPO publications have bibliographic XML without claim bodies. Capture failures and obsolete/failed discovery endpoints remain in the ledger/gaps.

A suitable demo is native `ep-ep1004359b1-claim-1` against `us-patent-5783810-page-7-1`. EP1004359B1 description paragraph0010 really cites US5,783,810A. Their inclusion is comparative technical evidence, not a family match or an examiner's conclusion. The case's notice remains an explicitly authored simulation.

## Capture policy and audit

`capture-ledger.json` is the latest receipt index. `capture-events.jsonl` is append-only: initial actual receipts and their nested failures were imported without inventing historical timestamps; later metadata corrections and capture attempts append events. A source-specific policy correction explicitly preserved the previous overly generic EPO annotation. Subsequent refreshes retain prior raw bytes when content changes. An unreferenced initial EPO probe duplicate was removed with its hash/canonical path logged; the real captured document remains.

EPO Publication Server REST explicitly allows publication XML/PDF access. Its captured current service overview says5GB/7days while REST reference revision1.6 says10GB/7days. This contradiction remains unresolved; the conservative task ceiling is below either limit. WIPO's drafting manual states CC BY4.0 and requires attribution. Other official public pages/publications are bounded internal-pilot captures; no blanket redistribution license is asserted. Company commentary is historical secondary context. PATENTSCOPE FAQ expressly prohibits robots/bulk downloads, so no patent-result/fulltext crawling was performed there. See `source-policy.json`.

Captures are explicit allowlisted endpoints, synchronous with one request at a time, at most100 attempts/run,24MiB/file and150MiB stored raw, with at most two retries for429/502/503/504. A403/CAPTCHA is not retried or bypassed. Where Python's local CA trust failed, normal system curl succeeded with certificate verification enabled; both attempts are preserved. No insecureTLS fallback is used.

## Rebuild and refresh

Run from the project root:

```sh
python3 patents/ingest/build.py
node patents/ingest/validate.mjs
node --test test/patent-data.test.mjs
```

Build is offline and model-free. `builtAt` derives from the maximum immutable successful capture timestamp, so unchanged inputs produce byte-identical catalog content/digest. Writes are atomic. Source, extraction, exact span, authority, OCR, date, dependency and digest drift fail validation.

For an authorized targeted refresh, inspect source policy first, then:

```sh
python3 patents/ingest/capture.py --only SOURCE_ID --refresh
python3 patents/ingest/build.py
node patents/ingest/validate.mjs
```

Do not remove failed receipts or silently replace an old approved release. Review the captured change, classify version/temporal conflicts, then have a qualified lawyer review article scope, dates, OCR and claim meaning. Any SOT promotion requires a separate named review decision bound to dataset digest and source/extraction hashes; do not set this candidate's `humanReview` to fabricate approval. Cases must explicitly refresh source selection; prior approved exports keep their frozen evidence.

OCR is optional and requires installed Poppler/Tesseract plus explicitly supplied traineddata. The receipts record engine, language, scale and traineddata hashes. The small official Vietnamese traineddata came from `tesseract-ocr/tessdata_fast`; it and the existing English data are cached only in ignored `work/patent-ocr/tessdata`, outside the shipped dataset. OCR command:

```sh
python3 patents/ingest/ocr.py vn-patent-47032 --tessdata work/patent-ocr/tessdata
```

Search uses deterministic lexical matching plus explicitly assistant-curated bilingual hints. VN questions can retrieve PCT/EP comparative guidance with source jurisdiction visible. Source publication dates filter patent results where known; this is not an article-applicability engine. Dates later than captured coverage, unsupported jurisdiction and malformed dates ask for context. Ranking is reproducible and diversified by source, but recall is not certified by these seed tests.
