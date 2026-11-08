import sys, re, json, glob
sys.path.insert(0,'.')
from dotenv import load_dotenv; load_dotenv()
from collections import Counter, defaultdict
import modules.transactions.sales_import_v1 as si
import openpyxl
sql = open('migrations/sales/seed_template_aadl_multi_format_sales.sql', encoding='utf-8').read()
rules = json.loads(re.search(r"\$json\$(.*?)\$json\$", sql, re.S).group(1))
tpl = {"id": "x", "file_type": "Multi", "mapping_rules": rules}
kand = [si._template_dari_varian(tpl, v) for v in rules["variants"]]
for f in sorted(glob.glob('../dataset/Sales/AADL/*/*.xlsx')):
    c = open(f,'rb').read()
    nm = f.split('AADL')[1][1:]
    m = si._cocokkan_template(c, 'Excel', None) if False else si._cocokkan_template_excel_bulanan(c, kand)
    if not m:
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        print("NO MATCH", nm, wb.sheetnames)
        for s in wb.sheetnames[:14]:
            r = next(wb[s].iter_rows(min_row=2, max_row=2, values_only=True), None)
            print("    ", repr(s), [v for v in (r or []) if v is not None][:3])
        continue
    h = si._ekstrak_dengan_template(m[1], m[0], f)
    per = defaultdict(float)
    for r in h:
        if r['tanggal']: per[r['tanggal'].strftime('%Y-%m')] += r['total']
    inv = [r for r in h if not r['is_valid']]
    print("OK", nm[:70], "|", m[0]['mapping_rules']['cabang_tetap'], "| rows", len(h), "invalid", len(inv), "dup", sum(r['is_duplicate_candidate'] for r in h))
    print("    ", {k: round(v) for k, v in sorted(per.items())})
    for r in inv[:6]: print("     INVALID:", r['validation_notes'])
