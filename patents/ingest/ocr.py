"""Optional, explicit OCR capture of source-image pages. Not legal verification."""
import argparse
import csv
import hashlib
import io
import json
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source_id')
    parser.add_argument('--language', default='vie+eng')
    parser.add_argument('--tessdata', required=True)
    parser.add_argument('--pages')
    args = parser.parse_args()
    source = json.loads((ROOT / 'patents/data/capture-ledger.json').read_text())[args.source_id]
    path = ROOT / source['snapshot']
    info = subprocess.check_output(['pdfinfo', str(path)]).decode()
    total = int(re.search(r'^Pages:\s+(\d+)', info, re.M)[1])
    if args.pages:
        first, last = map(int, args.pages.split('-'))
    else:
        first, last = 1, total
    if not 1 <= first <= last <= total or last - first + 1 > 48:
        raise ValueError('OCR page budget exceeded')
    work = ROOT / 'work/patent-ocr'
    work.mkdir(parents=True, exist_ok=True)
    output = ROOT / ('patents/data/extracts/' + args.source_id + '.ocr.json')
    existing = json.loads(output.read_text()) if output.exists() else None
    if existing and existing['sourceSHA256'] == source['sha256'] and existing['pageRange'] == [first, last]:
        print('Retained OCR', args.source_id)
        return
    pages = []
    for number in range(first, last + 1):
        image = work / (args.source_id + '-page-' + str(number))
        subprocess.run(['pdftoppm', '-f', str(number), '-l', str(number), '-scale-to', '2200', '-png', '-singlefile', str(path), str(image)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        command = ['tesseract', str(image) + '.png', 'stdout', '--tessdata-dir', args.tessdata, '-l', args.language, '--psm', '3']
        text = subprocess.check_output(command, stderr=subprocess.PIPE, timeout=25, env={**os.environ, 'OMP_THREAD_LIMIT': '1'}).decode('utf-8')
        # Keep OCR verbatim. Never repair words, claim numbers or references by model.
        pages.append({'page': number, 'text': text})
        image.with_suffix('.png').unlink(missing_ok=True)
        print(args.source_id, number, len(text), flush=True)
    receipt = {'schemaVersion': 1, 'sourceId': args.source_id, 'sourceSHA256': source['sha256'], 'pageRange': [first, last],
               'engine': subprocess.check_output(['tesseract', '--version'], stderr=subprocess.STDOUT).decode().splitlines()[0],
               'language': args.language, 'maxImageDimension': 2200, 'pages': pages,
               'textFidelity': 'ocr_unreviewed', 'humanReview': None,
               'trainedData': {name: hashlib.sha256((Path(args.tessdata) / (name + '.traineddata')).read_bytes()).hexdigest() for name in args.language.split('+')},
               'warnings': ['OCR is candidate text, not source-native digital text or lawyer verification.', 'Do not silently repair text or infer missing claims.']}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')

if __name__ == '__main__':
    main()
