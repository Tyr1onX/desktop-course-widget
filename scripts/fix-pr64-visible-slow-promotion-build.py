from pathlib import Path

path = Path('src/widget-page.ts')
source = path.read_text(encoding='utf-8')
before = '...sharedMotions.map((motion, index) => animateElement('
after = '...sharedMotions.map((motion) => animateElement('
count = source.count(before)
if count != 1:
    raise RuntimeError(f'Expected one shared motion map signature, found {count}')
path.write_text(source.replace(before, after, 1), encoding='utf-8')
