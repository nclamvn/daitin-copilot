"""Rebuild the local evidence index from pinned official files."""
import argparse
from collections import Counter, defaultdict
from datetime import date, datetime
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import unicodedata
from urllib.parse import urlparse
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import pdfplumber
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parent
AS_OF = '2026-11-10'
ALLOWED = {'datafiles.chinhphu.vn', 'congbaocdn.chinhphu.vn', 'ipvietnam.gov.vn', 'www.ipvietnam.gov.vn', 'www.wipo.int'}
VOCAB = '{http://www.wipo.int/classifications/ncl}'

def need(ok, message):
    if not ok:
        raise ValueError(message)

def file_hash(path):
    with path.open('rb') as f:
        return sha256(f.read()).hexdigest()

def fold(s):
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', ''.join(c for c in unicodedata.normalize('NFD', s.lower())
        if not unicodedata.combining(c)).replace('đ','d')).split())

def compact(s):
    return ' '.join((s or '').split())

def source_file(doc):
    need(doc['storage'] in ('mvp','copilot') and re.fullmatch(r'[a-z0-9-]+\.(pdf|zip|xlsx)', doc['file']), 'SOURCE_PATH')
    return (ROOT if doc['storage']=='copilot' else ROOT.parent/'corpus')/'snapshots'/doc['file']

def zip_xml(path, pattern):
    with ZipFile(path) as arc:
        entries=[f for f in arc.infolist() if re.fullmatch(pattern,f.filename)]
        need(len(entries)==1 and entries[0].file_size <= 4_000_000, f'XML_MEMBER {path.name}')
        text=arc.read(entries[0])
    need(b'<!DOCTYPE' not in text and b'<!ENTITY' not in text, 'XML_DECLARATION')
    return ET.fromstring(text),entries[0].filename

def wipo(records, year):
    stem='nice-'+year[2:]
    source=records[stem]; structure=records[stem+'-structure']
    tree, smember=zip_xml(source_file(structure), r'ncl-\d{8}-classification_top_structure-\d{8}\.xml')
    classes=tree.findall(f'{VOCAB}Class')
    need({int(x.get('classNumber')) for x in classes}==set(range(1,46)), 'NICE_CLASSES')
    terms={}
    for lang in ('en','fr'):
        xt, member=zip_xml(source_file(source), rf'ncl-\d{{8}}-{lang}-classification_texts-\d{{8}}\.xml')
        need(xt.get('language')==lang and xt.get('dateInForce')==year+'-01-01' and
             tree.get('dateInForce')==year+'-01-01' and xt.get('edition')==tree.get('edition')=='13','NICE_VERSION')
        content={}
        for row in xt.findall(f'.//{VOCAB}GoodOrServiceTexts'):
            key=row.get('idRef')
            values=list(dict.fromkeys(compact(''.join(label.itertext())) for label in row.iter(VOCAB+'Label')))
            need(key not in content and values and all(values),'NICE_TEXT')
            content[key]=values
        terms[lang]=(member,content)
    entries={}
    visited=set()
    for cl in classes:
        cls=int(cl.get('classNumber'))
        for row in cl.findall(f'{VOCAB}GoodOrService'):
            code=f'{cls:02d}'+row.get('basicNumber')
            uid=row.get('id')
            need(re.fullmatch(r'\d{6}',code) and code not in entries and uid not in visited and
                 all(uid in info[1] for info in terms.values()), 'NICE_JOIN '+code)
            visited.add(uid)
            entries[code]=(year,code,cls,uid,' / '.join(terms['en'][1][uid]),' / '.join(terms['fr'][1][uid]))
    need(all(set(info[1])==visited for info in terms.values()),'NICE_DANGLING')
    provenance={'textSource':stem,'structureSource':stem+'-structure','structureMember':smember,
                'enMember':terms['en'][0],'frMember':terms['fr'][0]}
    return entries,provenance

def vietnamese(path, expected, pages):
    rows=defaultdict(list); alerts=[]
    with pdfplumber.open(path) as pdf:
        need(len(pdf.pages)==pages,'NICE_VN_PAGES')
        for page in pdf.pages:
            for table in page.extract_tables():
                for pos,cells in enumerate(table,1):
                    if len(cells)!=5:
                        continue
                    cl, code, vi, _, _ = (compact(x) for x in cells)
                    if not re.fullmatch(r'\d{6}', code):
                        continue
                    if not cl.isdigit() or int(cl)!=int(code[:2]) or not vi:
                        alerts.append((code,page.page_number,'row_shape'))
                        continue
                    if code not in expected or expected[code][2]!=int(cl):
                        alerts.append((code,page.page_number,'wipo_code_mismatch'))
                        continue
                    rows[code].append((page.page_number,pos,vi))
            page.close()
    resolved={}
    for code,found in rows.items():
        if len({fold(row[2]) for row in found})>1:
            alerts.extend((code,row[0],'conflicting_vietnamese') for row in found)
        else:
            resolved[code]=found[0]
    need(len(resolved) >= 9000, 'NICE_VN_COVERAGE')
    return resolved,alerts

def events(path):
    workbook=load_workbook(path,read_only=True,data_only=True,keep_links=False)
    try:
        need(workbook.sheetnames==['Table 1-Export'],'EVENT_SHEET')
        sheet=workbook[workbook.sheetnames[0]]
        need(sheet.max_column==4 and 1000 <= sheet.max_row <= 100000, 'EVENT_SCHEMA')
        rows=sheet.values
        title,*_=next(rows)
        need(title=='DANH SÁCH ĐƠN ĐĂNG KÝ NHÃN HIỆU CHUYỂN CÔNG BỐ NĂM 2026', 'EVENT_TITLE')
        next(rows)
        need(next(rows)==('Số đơn','Ngày nộp đơn','Ngày chuyển công bố (ngày được coi là hợp lệ)','Kỳ đăng tải'),
             'EVENT_HEADERS')
        valid=[]; rejected=[]
        for row,(number,filed,transfer,week) in enumerate(rows,4):
            if not any((number,filed,transfer,week)): continue
            if (not isinstance(number,str) or not re.fullmatch(r'4-\d{4}-\d{5,6}',number) or
                not all(isinstance(v,datetime) for v in (filed,transfer)) or not isinstance(week,str) or
                not re.fullmatch(r'Tuần \d{1,2}',week.strip())):
                rejected.append((row,'schema'))
                continue
            if filed.date()>transfer.date():
                rejected.append((row,'filing_after_transfer'))
                continue
            if transfer.date()>date.fromisoformat(AS_OF) or transfer.year!=2026:
                rejected.append((row,'outside_snapshot_period'))
                continue
            if filed.year!=int(number[2:6]):
                rejected.append((row,'application_year_disagrees_with_filing_date'))
                continue
            valid.append((row,number,filed.date().isoformat(),transfer.date().isoformat(),week.strip()))
        need(len(valid)>30000,'EVENT_COVERAGE')
        return valid,rejected
    finally:
        workbook.close()

def pdf_pages(doc):
    path=source_file(doc)
    count=doc['pages']
    raw=subprocess.check_output(['pdftotext','-layout',str(path),'-'],timeout=35).decode()
    pages=raw.split('\f')
    need(not pages.pop().strip(),'PDF_EOF')
    need(len(pages)==count,'PDF_PAGE_COUNT '+doc['id'])
    return pages

def schema(db):
    db.executescript("""
    PRAGMA foreign_keys=ON;
    CREATE TABLE source(id TEXT PRIMARY KEY, manifest TEXT NOT NULL);
    CREATE TABLE page(source TEXT REFERENCES source, page INT, text TEXT, PRIMARY KEY(source,page));
    CREATE VIRTUAL TABLE law_find USING fts5(source UNINDEXED, page UNINDEXED, tokens);
    CREATE TABLE nice(edition TEXT, code TEXT, class INT, uid TEXT, en TEXT, fr TEXT, vn TEXT, vn_page INT, vn_row INT,
                      PRIMARY KEY(edition,code));
    CREATE VIRTUAL TABLE nice_find USING fts5(edition UNINDEXED, code UNINDEXED, tokens);
    CREATE TABLE event(row INT PRIMARY KEY, application TEXT, filed TEXT, transferred TEXT, posted_week TEXT);
    CREATE INDEX event_number ON event(application);
    CREATE TABLE claim(id TEXT PRIMARY KEY, source TEXT, page INT, record TEXT, FOREIGN KEY(source,page) REFERENCES page(source,page));
    CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
    """)

def build(output):
    manifests=json.loads((ROOT/'sources.json').read_text())
    workflow=json.loads((ROOT/'workflows.json').read_text())
    parent_path=ROOT.parent/'sot/candidate.json'
    parent=json.loads(parent_path.read_text())
    for id,doc in manifests.items():
        url=urlparse(doc['url'])
        need(id==doc['id'] and url.scheme=='https' and url.hostname in ALLOWED and not url.username and not url.password and
             not url.port and doc['use']=='local_review','SOURCE_RIGHTS '+id)
        path=source_file(doc)
        need(file_hash(path)==doc['sha256'],'SNAPSHOT_HASH '+id)
    for id,doc in parent['payload']['registry']['documents'].items():
        need(doc['sha256']==manifests[id]['sha256'],'PARENT_SOURCE '+id)
    stage=output.with_name(output.name+'.writing-'+str(os.getpid()))
    try:
        with sqlite3.connect(stage) as db:
            schema(db)
            metrics={'release':'dai-tin-copilot-m1-candidate','asOf':AS_OF,'parentSotDigest':parent['digest'],'sources':len(manifests),
                     'sourceCoverage':{}, 'editionProvenance':{}}
            for id,doc in manifests.items():
                db.execute('INSERT INTO source VALUES(?,?)',(id,json.dumps(doc,ensure_ascii=False,sort_keys=True)))
                if doc['type']!='pdf': continue
                pages=pdf_pages(doc)
                text_pages=0
                for n,page in enumerate(pages,1):
                    tokens=fold(page)
                    if len(tokens)<35: continue
                    db.execute('INSERT INTO page VALUES(?,?,?)',(id,n,page.strip()))
                    if id!='nice-vn26':
                        db.execute('INSERT INTO law_find VALUES(?,?,?)',(id,n,tokens))
                    text_pages+=1
                metrics['sourceCoverage'][id]={'totalPages':len(pages),'textPages':text_pages}
            print('PDF snapshots validated',flush=True)
            for id,cl in workflow['claims'].items():
                row=db.execute('SELECT text FROM page WHERE source=? AND page=?',(cl['source'],cl['page'])).fetchone()
                need(row is not None and cl['anchors'] and all(fold(a) in fold(row[0]) for a in cl['anchors']),
                     'CLAIM_EVIDENCE '+id)
                db.execute('INSERT INTO claim VALUES(?,?,?,?)',(id,cl['source'],cl['page'],json.dumps(cl,ensure_ascii=False,sort_keys=True)))
            used={id for group in workflow['workflows'].values() for id in group['claims']}
            need(used==set(workflow['claims']) and set(workflow['workflows'])==set(parent['payload']['registry']['procedures']),
                 'WORKFLOW_CLAIMS')
            for year in ['2026','2027']:
                full,provenance=wipo(manifests,year)
                vn,alerts=vietnamese(source_file(manifests['nice-vn26']),full,manifests['nice-vn26']['pages']) if year=='2026' else ({},[])
                for code in sorted(full):
                    vn_page,vn_row,vi=vn.get(code,(None,None,None))
                    db.execute('INSERT INTO nice VALUES(?,?,?,?,?,?,?,?,?)',(*full[code],vi,vn_page,vn_row))
                    db.execute('INSERT INTO nice_find VALUES(?,?,?)',(year,code,fold(' '.join([code,*full[code][-2:],vi or '']))))
                metrics['editionProvenance'][year]={**provenance,'codes':len(full),'vnLocated':len(vn),'classes':len({x[2] for x in full.values()})}
                if year=='2026':
                    metrics['niceVnReviewQueue']=alerts
                print('Nice',year,len(full),'VN',len(vn),flush=True)
            valid,rejected=events(source_file(manifests['tm-events']))
            db.executemany('INSERT INTO event VALUES(?,?,?,?,?)',valid)
            counts=Counter(x[1] for x in valid)
            metrics['events']={'rows':len(valid),'applicationNumbers':len(counts),'duplicateNumbers':sum(v>1 for v in counts.values()),
                'minTransfer':min(x[3] for x in valid),'maxTransfer':max(x[3] for x in valid),'reviewQueue':rejected,
                'sheet':'Table 1-Export','locator':'physical XLSX row'}
            metrics['indexedLawPages']=db.execute('SELECT count(*) FROM law_find').fetchone()[0]
            metrics['claims']=len(workflow['claims'])
            metrics['workflows']=workflow['workflows']
            metrics['inputDigest']=sha256(b'\0'.join([(ROOT/'sources.json').read_bytes(),(ROOT/'workflows.json').read_bytes(),
                                                       parent['digest'].encode()])).hexdigest()
            db.execute('INSERT INTO metadata VALUES(?,?)',('report',json.dumps(metrics,ensure_ascii=False,sort_keys=True)))
            need(db.execute('PRAGMA integrity_check').fetchone()==('ok',),'DB_INTEGRITY')
        receipt=output.with_suffix('.receipt.json')
        receipt_stage=receipt.with_name(receipt.name+'.writing-'+str(os.getpid()))
        try:
            receipt_stage.write_text(json.dumps({'inputDigest':metrics['inputDigest'],'indexSha256':file_hash(stage),
                'parentSotDigest':parent['digest']},indent=2)+'\n')
            os.replace(stage,output)
            os.replace(receipt_stage,receipt)
        finally:
            receipt_stage.unlink(missing_ok=True)
        print(json.dumps({k:v for k,v in metrics.items() if k not in ('sourceCoverage','niceVnReviewQueue','workflows')},
                         ensure_ascii=False,indent=2))
    finally:
        stage.unlink(missing_ok=True)

if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--out',type=Path,default=ROOT/'evidence.sqlite')
    build(p.parse_args().out)
