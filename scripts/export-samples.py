"""Prints the code of every sample as JSON, using the site repository's own renderer, so the code matches the website.

    python3 -I scripts/export-samples.py <site repository>
"""
import importlib.util
import json
import sys
from pathlib import Path

folder = Path(sys.argv[1]) / 'src' / 'pages' / 'example'
spec = importlib.util.spec_from_file_location('render', folder / 'render.py')
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)


def text(item, demo, stack):
    return '\n'.join(line for line, _, _ in render.code(item, demo, stack))


samples = {}
for file in sorted((folder / 'items').glob('*.json')):
    item = json.loads(file.read_text(encoding='utf-8'))
    demos = render.demos(item)
    samples[item['slug']] = {
        stack: '\n\n'.join((f"// {demo['h']}\n" if len(demos) > 1 else '') + text(item, demo, stack) for demo in demos if stack in render.stacks(demo))
        for stack in render.FILES
    }
print(json.dumps(samples))
