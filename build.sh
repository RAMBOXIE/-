#!/usr/bin/env bash
# 打包:dist/escape-ai.html(独立完整版)+ dist/artifact.html(Artifact 无骨架版)
cd "$(dirname "$0")"
python - << 'PY'
import io, re
html = io.open('index.html', encoding='utf-8').read()
def inline(m):
    return '<script>\n' + io.open(m.group(1).split('?')[0], encoding='utf-8').read() + '\n</script>'
full = re.sub(r'<script src="([^"]+)"></script>', inline, html)
io.open('dist/escape-ai.html', 'w', encoding='utf-8', newline='\n').write(full)
# Artifact 版:去外壳标签,保留 <style> 与 <body> 内容
style = re.search(r'<style>.*?</style>', full, re.S).group(0)
body = re.search(r'<body>(.*)</body>', full, re.S).group(1)
art = '<title>逃离AI</title>\n' + style + '\n' + body
io.open('dist/artifact.html', 'w', encoding='utf-8', newline='\n').write(art)
# 可直接部署的静态站(Netlify / 任何静态托管)
import os
os.makedirs('dist/site', exist_ok=True)
io.open('dist/site/index.html', 'w', encoding='utf-8', newline='\n').write(full)
print('escape-ai.html', len(full), '| artifact.html', len(art), '| dist/site/index.html', len(full))
PY
