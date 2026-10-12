# Summarises the evaluation agents' transcripts: what each agent spent its steps on.
# Usage: python3 eval/analyze-transcripts.py <transcript folder>
# Prints one line per agent. Transcripts are Claude Code JSONL files (one event per line).
import json, re, sys, os

AGENTS = {
    'a46fc166e64455bd4': 'ts-mcp', 'a75a17c5e1a91a666': 'ts-nomcp',
    'a736973fba095fe16': 'react-mcp', 'a0c1d2f98127bb673': 'react-nomcp',
    'a8f1d29eb93772590': 'vue-mcp', 'a5e9f86e31503ce6d': 'vue-nomcp',
    'a1b12d4b71817656b': 'angular-mcp', 'a0d2fc74f3226e426': 'angular-nomcp',
    'a509eaaee1b919895': 'next-mcp', 'a1f582cc0b4a63aca': 'next-nomcp',
    'a9efe920a2128ec33': 'nuxt-mcp', 'a03f1627dd8b3790b': 'nuxt-nomcp',
    'a82314b5f2876716b': 'svelte-mcp', 'a52546dd9a3d98174': 'svelte-nomcp',
}
BUILD = re.compile(r'\b(npm run (build|check)|ng build|next build|vite build|nuxt (build|generate)|svelte-check|vue-tsc|tsc\b)')
VERIFY = re.compile(r'jsdom|\.verify|harness|probe|interact|verify|smoke|vm\.SourceTextModule|happy-dom|puppeteer|playwright', re.I)
DOCS = re.compile(r'froala\.com|npm (view|search|info)|unpkg|jsdelivr|github\.com/froala', re.I)

def analyse(path):
    calls, results = [], {}
    for line in open(path, encoding='utf8'):
        try:
            event = json.loads(line)
        except ValueError:
            continue
        message = event.get('message') or {}
        content = message.get('content')
        if not isinstance(content, list):
            continue
        for item in content:
            if item.get('type') == 'tool_use':
                calls.append(item)
            elif item.get('type') == 'tool_result':
                text = item.get('content')
                if isinstance(text, list):
                    text = ' '.join(c.get('text', '') for c in text if isinstance(c, dict))
                results[item.get('tool_use_id')] = (bool(item.get('is_error')), str(text or ''))
    kinds = {'mcp': 0, 'build': 0, 'verify': 0, 'docs': 0, 'code': 0}
    first_good_build = None
    builds_failed = 0
    interop_fix = None
    for i, call in enumerate(calls, 1):
        name, data = call.get('name'), call.get('input') or {}
        text = json.dumps(data)
        is_error, output = results.get(call.get('id'), (False, ''))
        command = data.get('command', '') if name == 'Bash' else ''
        if 'froala-mcp-' in command:
            kind = 'mcp'
        elif command and BUILD.search(command) and not VERIFY.search(command):
            kind = 'build'
            failed = is_error or bool(re.search(r'Exit code [1-9]|ERR!|\berror TS\d|✘ \[ERROR\]|Build failed|failed to compile', output))
            if failed:
                builds_failed += 1
            elif first_good_build is None:
                first_good_build = i
        elif VERIFY.search(text):
            kind = 'verify'
        elif name in ('WebFetch', 'WebSearch') or DOCS.search(command):
            kind = 'docs'
        else:
            kind = 'code'
        kinds[kind] += 1
        if interop_fix is None and name in ('Write', 'Edit', 'MultiEdit') and re.search(r'\.default\s*\?\?', text) and 'verify' not in text.lower():
            interop_fix = i
    return len(calls), kinds, first_good_build, builds_failed, interop_fix

folder = sys.argv[1]
print(f"{'agent':14} {'steps':>5} {'mcp':>4} {'docs':>4} {'code':>4} {'build':>5} {'verify':>6} {'1st ok build':>12} {'failed builds':>13} {'.default fix at':>15}")
for agent_id, label in sorted(AGENTS.items(), key=lambda kv: kv[1]):
    path = os.path.join(folder, f'{agent_id}.output')
    if not os.path.exists(path):
        continue
    steps, kinds, first_good, failed, fix = analyse(path)
    print(f"{label:14} {steps:5} {kinds['mcp']:4} {kinds['docs']:4} {kinds['code']:4} {kinds['build']:5} {kinds['verify']:6} {str(first_good or '-'):>12} {failed:13} {str(fix or '-'):>15}")
