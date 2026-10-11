"""Builds Kaizen-Sheet-Maker.html from app.src.html (inlines the three JS modules into the page)."""
import pathlib
root = pathlib.Path(__file__).resolve().parent
src = root
page = (src / 'app.src.html').read_text(encoding='utf-8')
for marker, name in (('/*@@CALC@@*/', 'kaizen-calc.js'), ('/*@@XLSX@@*/', 'kaizen-xlsx.js'), ('/*@@SUGGEST@@*/', 'kaizen-suggest.js')):
    page = page.replace(marker, (src / name).read_text(encoding='utf-8'))
head = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head><body>\n')
out = root / 'Kaizen-Sheet-Maker.html'
out.write_text(head + page + '\n</body></html>\n', encoding='utf-8')
print('built', out, len(page), 'chars')
