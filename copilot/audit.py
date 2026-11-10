"""Inspect the candidate and check explicitly selected official snapshot URLs."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import sqlite3
import subprocess
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parent
HOSTS={'datafiles.chinhphu.vn','congbaocdn.chinhphu.vn','ipvietnam.gov.vn','www.ipvietnam.gov.vn','www.wipo.int'}

def report():
    with sqlite3.connect((ROOT/'evidence.sqlite').as_uri()+'?mode=ro',uri=True) as db:
        data=json.loads(db.execute("SELECT value FROM metadata WHERE key='report'").fetchone()[0])
    data['niceVnReviewQueue']=dict(Counter(row[-1] for row in data['niceVnReviewQueue']))
    data['events']['reviewQueue']=dict(Counter(reason for _,reason in data['events']['reviewQueue']))
    data.pop('workflows')
    return data

def probe(ids):
    docs=json.loads((ROOT/'sources.json').read_text())
    missing=set(ids)-docs.keys()
    if missing:
        raise ValueError('ID nguồn không có trong danh mục: '+', '.join(sorted(missing)))
    failures=0
    for id in ids:
        doc=docs[id]
        url=urlparse(doc['url'])
        if url.scheme!='https' or url.hostname not in HOSTS or url.username or url.password or url.port:
            raise ValueError('URL nguồn không được phép '+id)
        record={'at':datetime.now(timezone.utc).isoformat(),'source':id,'expectedSha256':doc['sha256']}
        try:
            result=subprocess.run(['curl','-q','-fsS','--proto','=https','--max-time','20','--max-filesize',
                                   '25165824','--write-out','%{http_code}','--url',doc['url']],
                                  check=True,capture_output=True,timeout=23).stdout
            data,code=result[:-3],result[-3:]
            if code!=b'200' or len(data)>25165824 or not data.startswith(b'%PDF-' if doc['type']=='pdf' else b'PK'):
                raise ValueError('Kiểu tệp hoặc phản hồi nguồn chưa hợp lệ.')
            current=sha256(data).hexdigest()
            record.update(observedSha256=current,status='match' if current==doc['sha256'] else 'changed')
            if record['status']=='changed':
                incoming=ROOT/'incoming'
                incoming.mkdir(exist_ok=True)
                file=incoming/(id+'-'+current+'.'+doc['type'])
                if not file.exists():
                    with file.open('xb') as f: f.write(data)
        except (ValueError,subprocess.SubprocessError) as error:
            record.update(status='error',detail=str(error))
        with (ROOT/'source-log.jsonl').open('a') as log:
            log.write(json.dumps(record,ensure_ascii=False)+'\n')
        print(json.dumps(record,ensure_ascii=False))
        failures+=record['status']!='match'
    return failures

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('action',choices=('status','probe'))
    p.add_argument('ids',nargs='*')
    args=p.parse_args()
    if args.action=='probe' and not args.ids: p.error('Cần ít nhất một ID nguồn.')
    if args.action=='status': print(json.dumps(report(),ensure_ascii=False,indent=2))
    elif probe(args.ids): raise SystemExit(2)
