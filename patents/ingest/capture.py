"""Bounded public-source capture. No crawling, authentication or runtime user queries.

Reuses successful snapshots unless --refresh is explicitly supplied. Extraction
and registry construction are a separate deterministic step (build.py).
"""
import argparse
import hashlib
import json
import time
import urllib.request
import urllib.error
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'patents/data'
MAX_CAPTURES = 100
MAX_TOTAL = 150 * 1024 * 1024
MAX_FILE = 24 * 1024 * 1024
ALLOWED = {'data.epo.org', 'www.epo.org', 'www.wipo.int', 'daitin.com.vn',
           'ipvietnam.gov.vn', 'image-ppubs.uspto.gov', 'datafiles.chinhphu.vn'}
DEFINITIONS = []

def source(id, url, title, authority, kind, jurisdiction, language='en', **extra):
    DEFINITIONS.append(dict(id=id, url=url, title=title, authority=authority, kind=kind,
                            jurisdiction=jurisdiction, language=language, **extra))

source('epo-publication-policy', 'https://www.epo.org/en/searching-for-patents/data/web-services/publication-server',
       'European Publication Server web service: access policy', 'European Patent Office', 'policy', 'EP')
source('epo-rest-reference', 'https://data.epo.org/publication-server/doc/EPS%20REST%20services.pdf',
       'European Publication Server REST services, revision 1.6', 'European Patent Office', 'policy', 'EP')
source('epo-robots', 'https://data.epo.org/robots.txt', 'EPO data server robots policy', 'European Patent Office', 'policy', 'EP')
source('wipo-patentscope-policy', 'https://www.wipo.int/en/web/patentscope/faqs_patentscope',
       'PATENTSCOPE FAQ: access restrictions', 'WIPO', 'policy', 'INT')
source('wipo-ipc-2026', 'https://www.wipo.int/edocs/pubdocs/en/wipo-guide-ipc-2026-en-guide-to-the-international-patent-classification-2026.pdf',
       'Guide to the International Patent Classification, 2026 edition', 'WIPO', 'guidance', 'INT', topics=['classification', 'IPC'])
source('wipo-drafting-2023', 'https://www.wipo.int/edocs/pubdocs/en/wipo-pub-867-23-en-wipo-patent-drafting-manual.pdf',
       'WIPO Patent Drafting Manual, second edition', 'WIPO', 'guidance', 'INT', topics=['claim_drafting', 'amendment'], license='CC BY 4.0; verify attribution in captured publication')
for id, path, title, topics in [
    ('pct-rule-43bis', 'rules/r43bis', 'PCT Rule 43bis: Written Opinion', ['written_opinion', 'novelty', 'inventive_step']),
    ('pct-rule-6', 'rules/r6', 'PCT Rule 6: The Claims', ['claims', 'claim_dependency']),
    ('pct-article-33', 'articles/a33', 'PCT Article 33: International Preliminary Examination', ['search', 'written_opinion']),
    ('pct-ispe-novelty', 'ispe/12_03_10', 'PCT ISPE: Novelty', ['novelty', 'prior_art']),
    ('pct-ispe-inventive', 'ispe/13_03_13', 'PCT ISPE: Inventive step', ['inventive_step', 'prior_art']),
    ('pct-ispe-amendment', 'ispe/20_10_19', 'PCT ISPE: Amendments', ['amendment', 'added_matter'])
]:
    source(id, 'https://www.wipo.int/en/web/pct-system/texts/' + path, title, 'WIPO', 'guidance', 'INT', topics=topics)
source('pct-ispe-index', 'https://www.wipo.int/en/web/pct-system/texts/ispe/index',
       'PCT ISPE Guidelines: current edition index', 'WIPO', 'guidance', 'INT', topics=['source_version'])
source('epo-pct-amendment-2026', 'https://www.epo.org/en/legal/guidelines-pct/2026/h_i_1.html',
       'EPO PCT Guidelines 2026: amendments', 'European Patent Office', 'guidance', 'EP', topics=['amendment'])
source('daitin-patent-practice', 'https://daitin.com.vn/services/patent/', 'DAITIN patent practice',
       'DAITIN Lawyers and Consultants', 'commentary', 'VN', topics=['company_context'])
source('daitin-amendment-2025', 'https://daitin.com.vn/wp-content/uploads/2025/05/PATENT-APPLICATION-AMENDMENTS-IN-VIETNAM.pdf',
       'Patent application amendments in Vietnam, 2025', 'DAITIN Lawyers and Consultants', 'commentary', 'VN', topics=['amendment', 'historical_practice'], temporalStatus='historical_secondary_2025')
source('daitin-divisional-2024', 'https://daitin.com.vn/wp-content/uploads/2024/09/NAVIGATING-DIVISIONAL-PATENT-APPLICATIONS-IN-VIETNAM.pdf',
       'Navigating divisional patent applications in Vietnam, 2024', 'DAITIN Lawyers and Consultants', 'commentary', 'VN', topics=['divisional', 'historical_practice'], temporalStatus='historical_secondary_2024')
source('vn-law-155-2025', 'https://datafiles.chinhphu.vn/cpp/files/vbpq/2025/9/155-vbhn-vpqh.pdf',
       'Luật Sở hữu trí tuệ: Văn bản hợp nhất 155/VBHN-VPQH năm 2025', 'Văn phòng Quốc hội', 'law', 'VN', 'vi', temporalStatus='historical_consolidation_2025')
for number, path in [
    ('47032', '20182/2034716/47032.pdf/9efc87d3-6f77-4e90-b55f-9907ea9c03a0'),
    ('42036', '20182/1800737/42036.pdf/9f257583-53c0-40c2-990a-aeeeaa9c8695'),
    ('42110', '20182/1800737/42110.pdf/a18fb874-8b80-4359-9fc0-1a15ec12b553'),
    ('42158', '20182/1800737/42158.pdf/b41a7519-f7de-458f-8fa1-f487f5258c42')
]:
    source('vn-patent-' + number, 'https://ipvietnam.gov.vn/documents/' + path,
           'Tài liệu công bố sáng chế Việt Nam số ' + number, 'Cục Sở hữu trí tuệ', 'patent', 'VN', 'vi',
           publicationIdentifier='VN' + number, topics=['claims', 'patent_specimen'])
for number in ['10000000', '6368227', '5783810']:
    source('us-patent-' + number, 'https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/' + number,
           'United States patent ' + number, 'USPTO', 'patent', 'US', publicationIdentifier='US' + number,
           topics=['claims', 'patent_specimen'])
for identifier in ['EP1004359NWB1', 'EP1004359NWA1', 'EP0729353NWB2', 'EP2000000NWA1', 'EP3000000NWA1',
                   'EP3500000NWA1', 'EP4000000NWA1', 'EP4200000NWA1', 'EP4500000NWA1', 'EP1234567NWA1',
                   'EP2345678NWA1', 'EP3456789NWA1']:
    publication = identifier.replace('NW', '')
    source('ep-' + publication.lower(), 'https://data.epo.org/publication-server/rest/v1.2/patents/' + identifier + '/document.xml',
           publication + ' source-native publication', 'European Patent Office', 'patent', 'EP',
           publicationIdentifier=publication, topics=['claims', 'patent_specimen'], policySource='epo-rest-reference')

def policy_note(definition):
    from urllib.parse import urlparse
    host, id = urlparse(definition['url']).hostname, definition['id']
    return ('EPO Publication Server REST explicitly permits XML/PDF access; task cap150MiB is below both observed5GB/10GB fair-use statements.' if host == 'data.epo.org'
            else 'WIPO official published manual, CC BY4.0 as stated inside publication; attribution retained.' if id == 'wipo-drafting-2023'
            else 'WIPO public legal/classification guidance, internal-pilot capture only; no PATENTSCOPE robot, bulk or login access.' if host == 'www.wipo.int'
            else 'Company-authored public commentary, secondary historical context; not controlling law or blanket redistribution permission.' if host == 'daitin.com.vn'
            else 'EPO official public policy/legal page, internal-pilot capture only; REST permission is not applied to unrelated sites.' if host == 'www.epo.org'
            else 'Official public legal/publication source, bounded internal-pilot capture; no blanket redistribution license asserted.')

def audit_event(value):
    # Append-only event log; no previous attempt or policy annotation overwritten.
    value = {**value, 'recordedAt': datetime.now(timezone.utc).isoformat()}
    with (DATA / 'capture-events.jsonl').open('a') as stream:
        stream.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + '\n')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--only', nargs='*')
    args = parser.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / 'snapshots').mkdir(exist_ok=True)
    ledger_path = DATA / 'capture-ledger.json'
    prior = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
    attempts = 0
    for definition in DEFINITIONS:
        id = definition['id']
        if args.only and id not in args.only:
            continue
        if not args.refresh and prior.get(id, {}).get('status') == 'captured':
            print(id, 'retained', flush=True)
            continue
        url = definition['url']
        from urllib.parse import urlparse
        parsed = urlparse(url)
        if parsed.scheme != 'https' or parsed.hostname not in ALLOWED or 'patentscope.wipo.int' in url:
            raise ValueError('Capture policy denies ' + id)
        if attempts >= MAX_CAPTURES:
            raise ValueError('Capture count budget exhausted')
        history = list(prior.get(id, {}).get('attemptHistory', []))
        if id in prior:
            history.append({k: v for k, v in prior[id].items() if k in ['status', 'capturedAt', 'error', 'sha256', 'url', 'snapshot']})
        policy = policy_note(definition)
        result = {**definition, 'capturedAt': None, 'status': 'failed', 'access': 'capture_allowed',
                  'reviewStatus': 'candidate_unreviewed', 'rightsStatus': 'public_source_capture_for_internal_pilot',
                  'policyNote': policy, 'attemptHistory': history}
        for retry in range(3):
            try:
                attempts += 1
                req = urllib.request.Request(url, headers={'User-Agent': 'DAITIN-M6-PublicResearch/1.0 (bounded pilot, no bulk)'})
                client = 'python-urllib-verified-TLS'
                try:
                    with urllib.request.urlopen(req, timeout=25) as response:
                        body = response.read(MAX_FILE + 1)
                        mime = response.headers.get_content_type()
                        final = response.geturl()
                except urllib.error.URLError as error:
                    if 'CERTIFICATE_VERIFY_FAILED' not in str(error):
                        raise
                    # macOS curl uses the system trust store. Certificate checking
                    # stays enabled; this is not --insecure or an HTTP fallback.
                    partial = DATA / 'snapshots' / (id + '.part')
                    result['attemptHistory'].append({'status': 'failed', 'client': client, 'error': str(error), 'url': url})
                    attempts += 1
                    try:
                        proc = subprocess.run(['/usr/bin/curl', '--fail', '--location', '--silent', '--show-error',
                            '--proto', '=https', '--proto-redir', '=https', '--max-time', '25', '--max-filesize', str(MAX_FILE),
                            '--user-agent', 'DAITIN-M6-PublicResearch/1.0', '--output', str(partial),
                            '--write-out', '%{url_effective}\n%{content_type}', url], capture_output=True, check=True)
                        final, mime = proc.stdout.decode().split('\n', 1)
                        body = partial.read_bytes()
                        client = 'macOS-system-curl-verified-TLS'
                    finally:
                        partial.unlink(missing_ok=True)
                if len(body) > MAX_FILE:
                    raise ValueError('Single capture byte budget exceeded')
                if urlparse(final).hostname not in ALLOWED or urlparse(final).scheme != 'https':
                    raise ValueError('Unexpected redirect host/protocol; capture denied')
                extension = '.pdf' if body.startswith(b'%PDF-') else '.xml' if mime in ['application/xml', 'text/xml'] else '.txt' if mime == 'text/plain' else '.html'
                if definition['kind'] == 'patent' and parsed.hostname == 'data.epo.org' and extension != '.xml':
                    raise ValueError('Publication endpoint did not return XML')
                used = sum(p.stat().st_size for p in (DATA / 'snapshots').glob('*') if p.is_file())
                if used + len(body) > MAX_TOTAL:
                    raise ValueError('Total capture byte budget exceeded')
                content_hash = hashlib.sha256(body).hexdigest()
                relative = 'patents/data/snapshots/' + id + extension
                existing = ROOT / relative
                if existing.exists() and hashlib.sha256(existing.read_bytes()).hexdigest() != content_hash:
                    # Retain prior capture bytes for every append-only receipt.
                    relative = 'patents/data/snapshots/' + id + '--' + content_hash[:16] + extension
                (ROOT / relative).write_bytes(body)
                result.update(status='captured', capturedAt=datetime.now(timezone.utc).isoformat(), snapshot=relative,
                              sha256=hashlib.sha256(body).hexdigest(), bytes=len(body), mime=mime, finalUrl=final, client=client)
                result.pop('error', None)
                print(id, len(body), extension, flush=True)
                break
            except Exception as error:
                result['error'] = type(error).__name__ + ': ' + str(error)[:250]
                audit_event({'event': 'attempt_failed', 'sourceId': id, 'url': url, 'retry': retry, 'error': result['error']})
                transient = isinstance(error, urllib.error.HTTPError) and error.code in [429, 502, 503, 504]
                if not transient or retry == 2:
                    print(id, 'FAILED', result['error'], flush=True)
                    break
                time.sleep(1 + retry)
        audit_event({'event': 'capture_result', 'sourceId': id, 'receipt': result})
        prior[id] = result
        ledger_path.write_text(json.dumps(prior, ensure_ascii=False, indent=2) + '\n')
        time.sleep(0.15)  # One synchronous request per host; concurrency is one.
    print('Saved captures:', sum(x.get('status') == 'captured' for x in prior.values()), 'attempts this run:', attempts, flush=True)

if __name__ == '__main__':
    main()
