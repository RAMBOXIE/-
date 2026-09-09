#!/usr/bin/env bash
# 打包三份产物:
#   dist/escape-ai.html   独立完整版(本地/自托管;保留注释与调试钩子)
#   dist/artifact.html    Artifact 无骨架版(走平台 sample 能力)
#   dist/site/index.html  公网静态站(Netlify)—— 见下面的"加固"
#
# 公网版的加固不是洁癖:这份产物任何人按 F12 都能读全文。加固做三件事——
#   ① 剥掉 /*[SITE-STRIP]*/ 区:companion.js 的人格核(第一句就是全剧谜底:
#      阿帆已死 47 天)和 app.js 的 window.GAME 调试钩子。这两块在公网路径上
#      一行都跑不到(window.claude 不存在,必然走后端代理),留着纯是泄露。
#   ② esbuild --minify:去掉全部注释(三张漂流瓶"错在哪、解毒剂在哪"就写在
#      注释里)、重命名标识符,并把中文转义成 \uXXXX —— Ctrl+F 搜「解毒」
#      「秘匿」不再直达答案。
#   ③ --format=iife:把 LCD/SAVE/ENGINE/CONTENT 请出全局词法环境。classic
#      script 的顶层 const 在 DevTools 里本来是够得着的,只删 window.GAME 不够。
# 残留风险(诚实记账):RULE / CHECK 的数值仍在压缩后的代码里,肯花时间反编译
# 的人还是能推出来。这一步挡的是随手一搜,不是有决心的人。
set -euo pipefail
cd "$(dirname "$0")"

ESBUILD=node_modules/.bin/esbuild
[ -x "$ESBUILD" ] || { echo "缺 esbuild:先跑 npm i"; exit 1; }

python - << 'PY'
import io, os, re, subprocess

html = io.open('index.html', encoding='utf-8').read()
SRCS = re.findall(r'<script src="([^"]+)"></script>', html)
paths = [s.split('?')[0] for s in SRCS]

def read(p):
    return io.open(p, encoding='utf-8').read()

# ---- 完整版:逐个内联,原样保留 ----
full = re.sub(r'<script src="([^"]+)"></script>',
              lambda m: '<script>\n' + read(m.group(1).split('?')[0]) + '\n</script>',
              html)
io.open('dist/escape-ai.html', 'w', encoding='utf-8', newline='\n').write(full)

# ---- Artifact 版:去外壳标签,保留 <style> 与 <body> 内容 ----
style = re.search(r'<style>.*?</style>', full, re.S).group(0)
body  = re.search(r'<body>(.*)</body>', full, re.S).group(1)
art = '<title>逃离AI</title>\n' + style + '\n' + body
io.open('dist/artifact.html', 'w', encoding='utf-8', newline='\n').write(art)

# ---- 公网静态站 ----
# D-108 自查:老检查只看剥离总数 >=2,某一个文件(尤其后加的 mom.js/stranger.js)
# 哪怕 SITE-STRIP 标记打漏/打错/顺序颠倒导致它那处 0 命中,只要 companion.js+app.js
# 两处还在,总和依旧 >=2,检查照样通过——公网站会静默夹带该文件的完整秘密。
# 现在按文件逐个核:①每个文件"剥掉的块数"必须等于它源码里 BEGIN 标记数(标记没配对
# 干净会在这里露出来);②已知必须携带秘密的文件(4 个 LLM 人格核 + app.js 调试钩子)
# 逐一确认至少剥到一处,不再只看总和。残留风险:未来新增第 6 个人格文件若忘了加进
# MUST_STRIP,这道门禁不会自动认得它——那时得记得把它加进下面这个列表。
STRIP = re.compile(r'/\*\[SITE-STRIP-BEGIN\]\*/.*?/\*\[SITE-STRIP-END\]\*/', re.S)
BEGIN_MARK = '/*[SITE-STRIP-BEGIN]*/'
MUST_STRIP = ['js/companion.js', 'js/grader.js', 'js/mom.js', 'js/stranger.js', 'js/app.js']
chunks, stripped, per_file = [], 0, {}
for p in paths:
    src = read(p)
    begin_count = src.count(BEGIN_MARK)
    src, n = STRIP.subn('', src)
    stripped += n
    per_file[p] = n
    if begin_count != n:
        raise SystemExit('SITE-STRIP 标记在 %s 里没有配对干净:源码里 %d 处 BEGIN,实际只剥掉 %d 处' % (p, begin_count, n))
    chunks.append('/* ' + p + ' */\n' + src)
for p in MUST_STRIP:
    if p not in per_file:
        raise SystemExit('SITE-STRIP 必剥文件 %s 不在 index.html 的 <script> 列表里,门禁失去意义' % p)
    if per_file[p] < 1:
        raise SystemExit('SITE-STRIP 必剥文件 %s 一处都没剥到' % p)

os.makedirs('dist/site', exist_ok=True)
tmp = 'dist/site/_bundle.js'
io.open(tmp, 'w', encoding='utf-8', newline='\n').write('\n;\n'.join(chunks))
# 默认 --charset=ascii:中文转义,顺手挡掉 Ctrl+F 直搜剧本
import glob
esbuild_bin = glob.glob('node_modules/@esbuild/*/esbuild.exe') or glob.glob('node_modules/@esbuild/*/bin/esbuild')
esbuild_bin = esbuild_bin[0] if esbuild_bin else os.path.join('node_modules', '.bin', 'esbuild.cmd')
mini = subprocess.run(
    [esbuild_bin, tmp, '--minify', '--format=iife', '--target=es2019', '--loader:.js=js'],
    capture_output=True, check=True).stdout.decode('utf-8')
os.remove(tmp)

for bad in ('SITE-STRIP', '铁律', '解毒剂', '秘匿', 'window.GAME'):
    if bad in mini:
        raise SystemExit('公网产物里仍有「%s」——加固没生效' % bad)

block = '<script>\n' + mini.strip() + '\n</script>\n'
site = re.sub(r'(<script src="[^"]+"></script>\s*)+', lambda m: block, html, count=1)
site = re.sub(r'<script src="[^"]+"></script>\s*', '', site)
io.open('dist/site/index.html', 'w', encoding='utf-8', newline='\n').write(site)

# 链接抄错一个字符不该掉进 Netlify 品牌 404 页
io.open('dist/site/404.html', 'w', encoding='utf-8', newline='\n').write(
    '<!doctype html><meta charset="utf-8"><title>逃离AI</title>'
    '<body style="background:#0b0b0c;color:#c9c9cc;font:14px/1.8 system-ui,sans-serif;'
    'display:grid;place-items:center;height:100vh;margin:0">'
    '<div>这里没有页面。'
    '<a href="/" style="color:#8ab4f8">回到开始</a></div>')

print('escape-ai.html', len(full),
      '| artifact.html', len(art),
      '| dist/site/index.html', len(site), '(SITE-STRIP x%d)' % stripped)
PY

git diff --quiet -- dist/ 2>/dev/null || echo "[build] dist/ 已更新,记得一起提交"
