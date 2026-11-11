"""Offline deterministic evidence extraction and candidate registry build.

No model, network, authority promotion, family merging or legal applicability
decision occurs here. Every record points to an exact saved-text span.
"""
import hashlib
import html
from html.parser import HTMLParser
import json
import os
import re
import subprocess
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'patents/data'
EXTRACTS = DATA / 'extracts'
sha = lambda b: hashlib.sha256(b).hexdigest()
canonical = lambda v: json.dumps(v, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
utf16 = lambda s: len(s.encode('utf-16-le')) // 2

def write_atomic(path, value):
    scratch = path.with_name('.' + path.name + '.' + str(os.getpid()) + '.tmp')
    try:
        scratch.write_text(value, encoding='utf-8')
        scratch.replace(path)
    finally:
        scratch.unlink(missing_ok=True)

class TextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip = [], 0
    def handle_starttag(self, tag, attrs):
        if tag in ['script', 'style', 'noscript', 'svg', 'head', 'nav', 'header', 'footer']:
            self.skip += 1
        if not self.skip and tag in ['p', 'div', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'section', 'article']:
            self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ['script', 'style', 'noscript', 'svg', 'head', 'nav', 'header', 'footer']:
            self.skip = max(0, self.skip - 1)
        if not self.skip and tag in ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4']:
            self.parts.append('\n')
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
    def text(self):
        lines = [re.sub(r'[\t \r\xa0]+', ' ', x).strip() for x in ''.join(self.parts).split('\n')]
        return '\n'.join(x for x in lines if x)

def pdf_pages(path):
    output = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', str(path), '-'], capture_output=True, check=True)
    text = output.stdout.decode('utf-8')
    pages = text.split('\f')
    if not pages[-1].strip(): pages.pop()
    return [{'page': index + 1, 'text': text} for index, text in enumerate(pages)], output.stderr.decode('utf-8').strip()

def iso(raw):
    if re.fullmatch(r'\d{8}', raw or ''):
        return raw[:4] + '-' + raw[4:6] + '-' + raw[6:]
    return None

def node_text(element):
    return re.sub(r'\s+', ' ', ''.join(element.itertext())).strip()

def english_title(root):
    box = root.find('.//B540')
    language = None
    for node in [] if box is None else box:
        if node.tag == 'B541': language = node_text(node)
        if node.tag == 'B542' and language == 'en': return node_text(node)
    return None

def topic_labels(text):
    plain = text.lower()
    topics = []
    patterns = {
        'novelty': ['tính mới', 'novelty', 'new invention'],
        'inventive_step': ['trình độ sáng tạo', 'inventive step', 'non-obvious'],
        'claims': ['yêu cầu bảo hộ', 'claim', 'phạm vi bảo hộ'],
        'amendment': ['sửa đổi', 'bổ sung', 'amend'],
        'divisional': ['tách đơn', 'divisional', 'division of'],
        'disclosure': ['bộc lộ', 'mô tả', 'disclosure', 'enablement', 'description'],
        'priority': ['ưu tiên', 'priority'],
        'classification': ['phân loại', 'classification', ' ipc', ' cpc'],
        'procedure': ['thẩm định', 'examination', 'written opinion', 'search report'],
        'industrial_applicability': ['áp dụng công nghiệp', 'industrial applicability']
    }
    for key, values in patterns.items():
        if any(value in plain for value in values): topics.append(key)
    return topics

def dependency_numbers(references):
    if not references: return None
    numbers = set()
    for reference in references:
        for first, last in re.findall(r'(\d+)\s*(?:to|through|-)\s*(\d+)', reference):
            if int(last) < int(first) or int(last) - int(first) > 100: return None
            numbers.update(range(int(first), int(last) + 1))
        numbers.update(int(value) for value in re.findall(r'\d+', reference))
    return sorted(numbers)

def main():
    EXTRACTS.mkdir(parents=True, exist_ok=True)
    ledger = json.loads((DATA / 'capture-ledger.json').read_text())
    successful = [row for row in ledger.values() if row.get('status') == 'captured']
    built_at = max(row['capturedAt'] for row in successful)
    definitions = []
    for row in successful:
        definitions.append({**row, 'captureStatus': 'captured'})
    old = json.loads((ROOT / 'copilot/sources.json').read_text())
    for key, temporal in [('vbhn160', 'consolidated_source_2026'), ('vbhn06', 'consolidated_source_2026'),
                          ('tt10', 'enacted_source_2026'), ('law131-cb', 'amending_source_2026'),
                          ('notice4863', 'agency_guidance_2026'), ('tt23', 'historical_source_2023'),
                          ('nd65', 'original_source_2023_amendments_unresolved'), ('nd100', 'amending_source_2026')]:
        item = old[key]
        directory = 'corpus/snapshots' if item['storage'] == 'mvp' else 'copilot/snapshots'
        definitions.append({'id': 'vn-' + key, 'title': item['label'], 'url': item['url'], 'authority': item['authority'],
                            'kind': 'guidance' if key == 'notice4863' else 'law', 'jurisdiction': 'VN', 'language': 'vi',
                            'snapshot': directory + '/' + item['file'], 'sha256': item['sha256'],
                            'capturedAt': None, 'registeredAt': built_at, 'captureStatus': 'reused_existing_snapshot',
                            'access': 'capture_allowed', 'reviewStatus': 'candidate_unreviewed', 'temporalStatus': temporal,
                            'rightsStatus': 'official_public_legal_text',
                            'policyNote': 'Reused official snapshot with existing verified hash; original capture time not re-invented. Consolidation is not an independent enactment.'})
    sources, records, gaps = [], [], []

    def add(source, text, start, end, title, kind=None, locator=None, **extra):
        value = text[start:end]
        if not value.strip(): return
        label = locator or {}
        records.append({'id': source['id'] + '-' + extra.pop('suffix'), 'sourceId': source['id'],
                        'kind': kind or ('procedure' if source['kind'] == 'policy' else source['kind']), 'title': title,
                        'text': value, 'locator': {**label, 'start': utf16(text[:start]), 'end': utf16(text[:end])},
                        'jurisdiction': source['jurisdiction'], 'topics': sorted(set(source.get('topics', []) + topic_labels(value))),
                        'provenance': 'secondary' if source['kind'] == 'commentary' else 'captured_primary',
                        'textFidelity': source.get('textFidelity', 'source_text_extraction'),
                        'effectiveFrom': None, 'effectiveTo': None, 'humanReview': None,
                        'evidenceSHA256': sha(value.encode()), **extra})

    for row in sorted(definitions, key=lambda item: item['id']):
        path = ROOT / row['snapshot']
        raw = path.read_bytes()
        if sha(raw) != row['sha256']: raise ValueError('SOURCE_HASH_MISMATCH:' + row['id'])
        source = {key: value for key, value in row.items() if key not in ['status', 'error', 'attemptHistory']}
        source.update(discoveryUrl=row.get('discoveryUrl', row['url']), sourceRole='company_secondary_commentary' if row['kind'] == 'commentary' else 'official_publication' if row['kind'] == 'patent' else 'official_guidance' if row['kind'] == 'guidance' else 'official_legal_version' if row['kind'] == 'law' else 'access_policy', humanReview=None, bytes=len(raw), effectiveFrom=None, effectiveTo=None,
                      legalStatus=None, family=None, sourceGroup=row['id'],
                      extractionStatus='extracted', temporalStatus=row.get('temporalStatus', 'source_version_not_an_applicability_decision'))
        block_records = []
        if path.suffix == '.xml':
            root = ET.fromstring(raw)
            publication = root.attrib.get('country', '') + root.attrib.get('doc-number', '') + root.attrib.get('kind', '')
            title = english_title(root)
            source.update(title=title or source['title'], publicationIdentifier=publication,
                          publicationDate=iso(root.attrib.get('date-publ')), applicationNumber=root.findtext('.//B210'),
                          sourceGroup='publication:' + publication,
                          priorityDate=None, priorities=[{'number': node_text(box.find('B310')) if box.find('B310') is not None else None,
                                                        'date': iso(box.findtext('B320')), 'country': box.findtext('B330')}
                                                       for box in root.findall('.//B300/B310/..')])
            pieces = ['Publication: ' + publication + '\nTitle: ' + (title or 'Unknown') + '\n']
            for section, elements in [('abstract', root.findall('.//abstract[@lang="en"]')),
                                      ('description', root.findall('.//description[@lang="en"]/p')),
                                      ('claim', root.findall('.//claims[@lang="en"]/claim'))]:
                for index, element in enumerate(elements, 1):
                    value = node_text(element)
                    number = int(element.attrib.get('num', str(index)))
                    prefix = '\n' + section.capitalize() + ' ' + str(number) + '\n'
                    start = len(''.join(pieces)) + len(prefix)
                    pieces.extend([prefix, value, '\n'])
                    block_records.append((start, start + len(value), section, number, element.attrib.get('id'), value))
            text = ''.join(pieces)
            source['extractionMethod'] = 'EPO source XML text nodes; whitespace normalized, no semantic rewriting'
            source['claimCount'] = sum(item[2] == 'claim' for item in block_records)
            source['textFidelity'] = 'source_native_xml'
            if source['claimCount'] == 0:
                source['extractionStatus'] = 'bibliographic_only'
                gaps.append({'sourceId': source['id'], 'kind': 'claims_not_in_xml', 'detail': 'Publication endpoint supplied bibliographic XML without source-native claim text. No claims inferred.'})
        elif path.suffix == '.pdf':
            pages, warnings = pdf_pages(path)
            ocr_path = EXTRACTS / (source['id'] + '.ocr.json')
            ocr_pages = None
            if ocr_path.exists():
                receipt = json.loads(ocr_path.read_text())
                if receipt['sourceSHA256'] != source['sha256']: raise ValueError('OCR_SOURCE_DRIFT:' + source['id'])
                ocr_pages = {item['page']: item['text'] for item in receipt['pages']}
                source['ocrReceipt'] = ocr_path.relative_to(ROOT).as_posix()
                source['ocrReceiptSHA256'] = sha(ocr_path.read_bytes())
            if source['id'].startswith('vn-patent-'):
                cover = pages[0]['text']
                title_match = re.search(r'\(54\)\s*(.*?)(?=\(57\)|$)', cover, re.S)
                if title_match: source['title'] = re.sub(r'\s+', ' ', title_match[1]).strip()
                app = re.search(r'\(21\)\s*(\S+)', cover)
                pub = re.search(r'\(45\)\s*(\d{2})/(\d{2})/(\d{4})', cover)
                filed = re.search(r'\(22\)\s*(\d{2})/(\d{2})/(\d{4})', cover)
                if app: source['applicationNumber'] = app[1]
                if pub: source['publicationDate'] = pub[3] + '-' + pub[2] + '-' + pub[1]
                if filed: source['applicationDate'] = filed[3] + '-' + filed[2] + '-' + filed[1]
                source['bibliographicExtraction'] = 'INID(21)/(22)/(45)/(54) from native PDF cover text; current legal status unknown'
            pieces, positions = [], []
            for page in pages:
                # The original cover text remains source-native; image body uses
                # OCR only where explicitly captured by the optional OCR step.
                content = page['text']
                fidelity = 'source_native_pdf_text'
                if ocr_pages and page['page'] in ocr_pages and len(content.strip()) < 100:
                    content = ocr_pages[page['page']]
                    fidelity = 'ocr_unreviewed'
                prefix = '\n\f\n'
                start = len(''.join(pieces)) + len(prefix)
                pieces.extend([prefix, content])
                positions.append({'page': page['page'], 'start': start, 'end': start + len(content), 'textFidelity': fidelity})
            text = ''.join(pieces)
            source.update(pageCount=len(pages), extractionMethod='pdftotext -layout UTF-8; optional separately-hashed OCR receipts',
                          textFidelity='mixed_native_and_ocr_unreviewed' if ocr_pages else 'source_native_pdf_text')
            source['pages'] = [{**item, 'start': utf16(text[:item['start']]), 'end': utf16(text[:item['end']])} for item in positions]
            source['extractionWarnings'] = warnings.splitlines() if warnings else []
            if source['id'] == 'vn-patent-47032':
                source['requiresOriginalCheck'] = True
                source['knownExtractionWarning'] = 'Visual spot-check PDF page18 found OCR technical-word/diacritic error (mạch thẳng) and unit glyph μm read as um. OCR is retained verbatim and must be checked against original; no semantic correction applied.'
                source['extractionWarnings'].append(source['knownExtractionWarning'])
            if source['kind'] == 'patent':
                source['claimCaptureStatus'] = 'ocr_candidate' if ocr_pages else 'claims_not_extracted'
                gaps.append({'sourceId': source['id'], 'kind': 'ocr_review_pending' if ocr_pages else 'patent_claims_not_extracted',
                             'detail': 'Image-only patent body: OCR is unreviewed and may misread units, claim numbers or column order.' if ocr_pages else 'Only available native text indexed; image-body claims have not been extracted or inferred.'})
            if len(text.strip()) < 100:
                source['extractionStatus'] = 'image_only_unextracted'
                gaps.append({'sourceId': source['id'], 'kind': 'image_only', 'detail': 'No usable text layer; no claim content inferred.'})
            block_records = positions
        else:
            if path.suffix == '.txt': text = raw.decode('utf-8')
            else:
                parser = TextParser(); parser.feed(raw.decode('utf-8')); text = parser.text()
            source.update(extractionMethod='HTMLParser text extraction; markup/navigation/scripts removed, whitespace normalized', textFidelity='source_html_text')
        text_path = EXTRACTS / (source['id'] + '.txt')
        write_atomic(text_path, text)
        source.update(textPath=text_path.relative_to(ROOT).as_posix(), textSHA256=sha(text_path.read_bytes()))
        sources.append(source)

        if path.suffix == '.xml':
            for start, end, section, number, fragment, value in block_records:
                references = re.findall(r'\bclaims?\s+(\d+(?:\s*(?:,|and|or|to|through|-)\s*\d+)*)', value, re.I) if section == 'claim' else []
                dependencies = dependency_numbers(references)
                dependency_status = 'explicit_text_references_only' if references else 'not_classified'
                if dependencies and any(value >= number or value < 1 for value in dependencies):
                    dependencies = None
                    dependency_status = 'source_reference_anomaly_unresolved'
                    gaps.append({'sourceId': source['id'], 'kind': 'claim_dependency_anomaly', 'detail': 'Claim ' + str(number) + ' contains apparent forward/self reference: ' + str(references) + '. Source text retained; dependencies unresolved.'})
                add(source, text, start, end, (source['publicationIdentifier'] + ' · ' + section.capitalize() + ' ' + str(number)),
                    locator={'label': section.capitalize() + ' ' + str(number), 'section': section, 'claim': number if section == 'claim' else None, 'fragment': fragment},
                    suffix=section + '-' + str(number), publicationIdentifier=source['publicationIdentifier'],
                    publicationDate=source.get('publicationDate'), priorityDate=source.get('priorityDate'),
                    claims=[{'number': number, 'text': value, 'dependencyReferences': references, 'dependsOn': dependencies,
                             'dependencyStatus': dependency_status, 'dependencyInterpretation': 'literal_numeric_references_not_legal_dependency_classification'}] if section == 'claim' else None)
        elif path.suffix == '.pdf':
            for position in block_records:
                content = text[position['start']:position['end']]
                page = position['page']
                if len(content.strip()) < 80: continue
                if source['kind'] == 'law':
                    if not any(word in content.lower() for word in ['sáng chế', 'giải pháp hữu ích', 'yêu cầu bảo hộ', 'thẩm định', 'sửa đổi', 'tách đơn']): continue
                # Page chunks preserve exact source text, including running heads.
                for part, offset in enumerate(range(0, len(content), 4500), 1):
                    start = position['start'] + offset; end = min(start + 4500, position['end'])
                    heading = re.search(r'Điều\s+\d+[^\n]{0,180}|\b\d{1,2}\.\s+[^\n]{12,100}', text[start:end])
                    title = (heading[0].strip() if heading else source['title']) + ' · trang ' + str(page)
                    add(source, text, start, end, title, locator={'label': 'Trang PDF ' + str(page) + (' · phần ' + str(part) if len(content) > 4500 else ''), 'page': page},
                        suffix='page-' + str(page) + '-' + str(part), textFidelity=position['textFidelity'])
            # Explicit bounded specimen claim zones observed in the official PDFs.
            # Verbatim OCR remains evidence, never silently spelling/number repaired.
            zones = {'vn-patent-47032': (18, 21), 'vn-patent-42110': (16, 19)}
            if source['id'] in zones and ocr_pages:
                first, last = zones[source['id']]
                zone_start = next(item['start'] for item in positions if item['page'] == first)
                zone_end = next(item['end'] for item in positions if item['page'] == last)
                matches = list(re.finditer(r'(?m)^(\d{1,2})[.]\s+', text[zone_start:zone_end]))
                expected = 1
                for index, match in enumerate(matches):
                    number = int(match[1])
                    if number != expected:
                        gaps.append({'sourceId': source['id'], 'kind': 'ocr_claim_number_gap', 'detail': 'Expected claim ' + str(expected) + ', observed ' + str(number) + '; subsequent claims not classified.'})
                        break
                    start = zone_start + match.start()
                    end = zone_start + (matches[index + 1].start() if index + 1 < len(matches) else zone_end - zone_start)
                    value = text[start:end]
                    refs = re.findall(r'theo điểm\s+(\d+(?:\s*(?:,|và|đến|-)\s*\d+)*)', value, re.I)
                    pages_used = [item['page'] for item in positions if item['end'] > start and item['start'] < end]
                    record_warnings = {}
                    if source['id'] == 'vn-patent-42110' and number == 1:
                        warning = 'Visual review of physical PDF pages16-17 confirms page-boundary OCR contamination inside claim1: standalone ae and page-header 42 110 interrupt the sentence. Exact transcription is retained; this known damaged claim must not be used for AI analysis or approval until a separately reviewed corrected version is published.'
                        record_warnings = {'knownExtractionWarning': warning, 'requiresOriginalCheck': True}
                        gaps.append({'sourceId': source['id'], 'recordId': source['id'] + '-claim-1', 'kind': 'known_ocr_contamination', 'detail': warning})
                    add(source, text, start, end, source['publicationIdentifier'] + ' · Yêu cầu bảo hộ ' + str(number) + ' (OCR chưa duyệt)',
                        locator={'label': 'Yêu cầu bảo hộ ' + str(number) + ' · PDF ' + str(pages_used[0]), 'claim': number, 'section': 'claim', 'page': pages_used[0], 'pageEnd': pages_used[-1]},
                        suffix='claim-' + str(number), publicationIdentifier=source['publicationIdentifier'], publicationDate=source.get('publicationDate'),
                        textFidelity='ocr_unreviewed', **record_warnings, claims=[{'number': number, 'text': value, 'dependencyReferences': refs,
                        'dependsOn': sorted({int(n) for ref in refs for n in re.findall(r'\d+', ref)}) if refs else None,
                        'dependencyStatus': 'ocr_references_unreviewed' if refs else 'not_classified'}])
                    expected += 1
                source['ocrClaimCount'] = expected - 1
        else:
            blocks = list(re.finditer(r'[^\n]+', text))
            for index, match in enumerate(blocks, 1):
                if len(match[0]) < 100: continue
                if source['kind'] != 'policy' and not topic_labels(match[0]) and source['kind'] != 'commentary': continue
                for part, offset in enumerate(range(0, len(match[0]), 4000), 1):
                    start = match.start() + offset; end = min(match.end(), start + 4000)
                    add(source, text, start, end, source['title'] + ' · đoạn ' + str(index),
                        locator={'label': 'Đoạn ' + str(index), 'paragraph': index}, suffix='paragraph-' + str(index) + '-' + str(part))

    for id, entry in ledger.items():
        if entry.get('status') != 'captured': gaps.append({'sourceId': id, 'kind': 'capture_failed', 'url': entry['url'], 'detail': entry.get('error')})
    gaps.extend([
        {'kind': 'source_policy_discrepancy', 'detail': 'EPO current overview says5GB/7days; captured REST reference revision1.6 says10GB/7days. Not reconciled. Task budget150MiB is below either.'},
        {'kind': 'restricted_source_not_crawled', 'detail': 'PATENTSCOPE FAQ prohibits robots/bulk downloads. No PATENTSCOPE patent-result/fulltext crawling performed; EPO explicit REST and official publication endpoints used.'},
        {'kind': 'legal_review_pending', 'detail': 'No lawyer has reviewed this candidate dataset. Legal source version is not automatically an applicability conclusion.'},
        {'kind': 'status_and_family_unknown', 'detail': 'No patent legal-status/FTO/validity or verified family database. Publication identifiers and source dates do not imply enforceable rights.'},
        {'kind': 'historical_versions', 'detail': '2025 consolidation and company2024/2025 practice notes are historical sources, not silently substituted for2026 laws. Article-level transition/commencement must be reviewed.'}
    ])
    catalog = {'schemaVersion': 1, 'builtAt': built_at, 'scope': 'VN patent copilot candidate, with explicitly foreign technical/PCT comparative references',
               'status': 'candidate', 'coverage': {'jurisdictions': ['VN', 'EP', 'US', 'INT'], 'checkedThrough': built_at[:10],
                                                  'complete': False, 'patentLegalStatusVerified': False, 'familyRelationsVerified': False},
               'retrievalHints': {'provenance': 'assistant_curated_search_hints_not_source_facts', 'pairs': [
                   ['tính mới', 'novelty'], ['trình độ sáng tạo', 'inventive step'], ['yêu cầu bảo hộ', 'claims'],
                   ['sửa đổi', 'amendment'], ['tách đơn', 'divisional'], ['mô tả đủ', 'enablement'],
                   ['bộc lộ', 'disclosure'], ['ưu tiên', 'priority'], ['phân loại', 'classification']]},
               'sources': sources, 'records': sorted(records, key=lambda item: item['id']), 'gaps': gaps}
    catalog['digest'] = sha(canonical(catalog))
    write_atomic(DATA / 'catalog.json', json.dumps(catalog, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'sources': len(sources), 'records': len(records), 'nativeClaims': sum(bool(x.get('claims')) and x['textFidelity'] == 'source_native_xml' for x in records), 'ocrClaims': sum(bool(x.get('claims')) and x['textFidelity'] == 'ocr_unreviewed' for x in records),
                      'rawAdditionalMiB': round(sum(p.stat().st_size for p in (DATA / 'snapshots').iterdir() if p.is_file()) / 1024**2, 2),
                      'digest': catalog['digest']}, ensure_ascii=False))

if __name__ == '__main__':
    main()
