"use strict";
/* 一次性工具:把用户提供的"全底本重构稿"(zz_dump_all_text.js 同格式的文本)
   合并回 js/content.js。规则:
   - 叙事字符串/数字全部采用新稿。
   - 涉及函数的字段(dilemmas[].a/b 第3项、traps[].detect、stranger.*.act/mark)
     保留现有实现,只替换文案(id/text/标签/body)。
   - threads/rules(框架共享,不在新稿覆盖范围内)保持原样不动。
   - chain(证据链id列表)、companion(AI伴侣身份)不在新稿覆盖范围内,保持原样。
   只读不改的东西一律从当前 content.js 提取(boot 一遍拿到真实函数引用)。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const CONTENT_PATH = ROOT + '/js/content.js';
const DUMP_PATH = process.argv[2];
if (!DUMP_PATH) {
  // 一次性迁移工具,不是常规门禁——被 run_all.js 的目录通配扫到时,不传参数
  // 直接跳过(exit 0),不能让它拖垮真正的门禁。
  console.log('zz_apply_rewrite.js 是一次性迁移工具,跳过(未传 dump 路径)。');
  process.exit(0);
}

const CONTENT_SRC = fs.readFileSync(CONTENT_PATH, 'utf8');
const DUMP_SRC = fs.readFileSync(DUMP_PATH, 'utf8');

/* ---------------- 1. 从当前 content.js 提取真实底本对象(含函数) ---------------- */
const DEP_FILES = ['js/lcd.js', 'js/save.js', 'js/companion.js', 'js/grader.js', 'js/mom.js', 'js/stranger.js', 'js/engine.js'];
const DEP_SRC = DEP_FILES.map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');
const ANCHOR = /const DOSSIER = \{ A: DOSSIER_A[^\n]*\n/;
const PATCHED = CONTENT_SRC.replace(ANCHOR, m => m + '  window.__ALLDOSSIERS = { A:DOSSIER_A,B:DOSSIER_B,C:DOSSIER_C,D:DOSSIER_D,E:DOSSIER_E,F:DOSSIER_F,G:DOSSIER_G,H:DOSSIER_H,I:DOSSIER_I,J:DOSSIER_J,K:DOSSIER_K,L:DOSSIER_L,M:DOSSIER_M };\n  return { __stop: true };\n');
function stubEnv() {
  const ctx = () => ({ imageSmoothingEnabled: false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData: (x,y,w,h) => ({ data: new Uint8Array(Math.max(1,w*h*4)) }),
    createImageData: (w,h) => ({ data: new Uint8ClampedArray(w*h*4) }), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width: 0, height: 0, getContext: () => ctx() });
  const storage = { _m: Object.create(null), getItem(k){ return k in this._m ? this._m[k] : null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
  const env = { performance: { now: () => 1000 }, document: { getElementById: id => id === 'lcd' ? canvas() : null, createElement: () => canvas() },
    localStorage: storage, addEventListener(){}, navigator: {}, location: { reload(){} },
    OVERLAY: { show(c,cb){ cb({ text: 'x', kept: false }); }, text(){} }, APP: { exportFeedback(){} }, AUDIO: { ensure(){},hiss(){},blip(){} }, HOLD: { active: false }, Math };
  env.window = env; return env;
}
function extractCurrentDossiers() {
  const env = stubEnv();
  const fn = new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";' + DEP_SRC + ';\n' + PATCHED);
  fn.call(env, env, env.document, env.performance, env.addEventListener, env.navigator, env.location, env.localStorage, env.OVERLAY, env.APP, env.AUDIO);
  return env.__ALLDOSSIERS;
}
const CURRENT = extractCurrentDossiers();

/* ---------------- 2. 解析用户新稿(dump 格式)---------------- */
function splitByDossier(text) {
  const parts = text.split(/={10,}\s*\n底本 ([A-M])\(([^)]*)\)[^\n]*\n={10,}/);
  const out = {};
  // parts[0] = 头部说明; 之后每组 [id, meta, body]
  for (let i = 1; i < parts.length; i += 3) {
    const id = parts[i];
    const body = parts[i + 2];
    out[id] = body;
  }
  return out;
}
function splitBySection(body) {
  const re = /--- \[[^\]]*\]  字段: ([^\s]+)\s*\([^)]*\) ---\n/g;
  const sections = [];
  let m, lastIdx = 0, lastPath = null;
  while ((m = re.exec(body))) {
    if (lastPath !== null) sections.push([lastPath, body.slice(lastIdx, m.index)]);
    lastPath = m[1];
    lastIdx = re.lastIndex;
  }
  if (lastPath !== null) sections.push([lastPath, body.slice(lastIdx)]);
  return sections;
}
/* 按行解析缩进块。返回 {lines:[{indent,key,value}]}——value 为 null 表示这是一个
   容器行(下面缩进更深的内容是它的值),否则 value 是解析出的字符串/数字。 */
function tokenizeLines(text) {
  /* 用户手写重构稿用的是"字面换行"而不是原 dump 工具的 JSON.stringify 转义
     (\n 变成两个字符 \ n)。所以一个字符串值经常横跨好几个原始行,需要先把
     "以 " 开头、但没有以 " 结尾"的行,和后续行拼起来,直到遇到以 " 结尾的行
     为止,再当成一个逻辑行喂给下面的解析器。 */
  const rawLines = text.split('\n');
  const toks = [];
  let i = 0;
  while (i < rawLines.length) {
    const raw = rawLines[i];
    if (!raw.trim()) { i++; continue; }
    const indent = raw.match(/^ */)[0].length / 2;
    let trimmed = raw.trim();
    if (trimmed.startsWith('"') && !(trimmed.length > 1 && trimmed.endsWith('"'))) {
      const buf = [trimmed];
      i++;
      while (i < rawLines.length) {
        const cont = rawLines[i];
        buf.push(cont);
        i++;
        const contTrim = cont.trim();
        if (contTrim.length > 0 && contTrim.endsWith('"')) break;
      }
      trimmed = buf.join('\n');
      toks.push({ indent, line: trimmed });
    } else {
      toks.push({ indent, line: trimmed });
      i++;
    }
  }
  return toks;
}
function parseScalar(line) {
  if (line === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(line)) return Number(line);
  if (line === '<function, 不含文案>') return '__FN__';
  if (line.startsWith('"')) {
    /* 手写稿两种情况混着用:单行值多半是规范 JSON 转义(\n 是反斜杠+n 两个
       字符,代表换行),跨行拼接出来的值则是裸换行、裸引号,不是合法 JSON。
       先按 JSON.parse 试一次,失败再退化成"掐头去尾,原样保留"。 */
    try { return JSON.parse(line); }
    catch (_) { return line.length >= 2 ? line.slice(1, -1) : ''; }
  }
  return line;
}

/* 各字段专用小解析器:输入该字段对应文本块(tokenizeLines 结果),按已知 schema 组装。 */
function parseMeta(toks) {
  const o = {};
  let i = 0;
  function readKV(depth) {
    const res = {};
    while (i < toks.length && toks[i].indent === depth) {
      const key = toks[i].line.replace(/:$/, ''); i++;
      if (i < toks.length && toks[i].indent === depth + 1 && !toks[i].line.endsWith(':')) {
        // 可能是标量,或者是数组(多个同缩进的标量)
        const vals = [];
        while (i < toks.length && toks[i].indent === depth + 1) { vals.push(parseScalar(toks[i].line)); i++; }
        res[key] = vals.length === 1 ? vals[0] : vals;
      } else if (i < toks.length && toks[i].indent === depth + 1) {
        res[key] = readKV(depth + 1);
      } else {
        res[key] = null;
      }
    }
    return res;
  }
  return readKV(0);
}
function parseSimpleObject(toks) { return parseMeta(toks); } // 复用同一套(cast.companion/cast.mother 结构相同)

function parseStringArray(toks) {
  // 形如: 一串裸字符串,每行一个(可能多行字符串已被 JSON.stringify 转义成单行)
  return toks.filter(t => t.indent === 0).map(t => parseScalar(t.line));
}

function parseRec(toks) {
  const o = {};
  let i = 0;
  const simpleKeys = ['listLabel','listRight','title','dur','val'];
  while (i < toks.length && simpleKeys.includes(toks[i].line.replace(/:$/, ''))) {
    const key = toks[i].line.replace(/:$/, ''); i++;
    o[key] = parseScalar(toks[i].line); i++;
  }
  // events: 是 key "events:" 然后交替 时间戳/字符串
  if (i < toks.length && toks[i].line === 'events:') {
    i++;
    const events = [];
    while (i < toks.length) {
      const t = parseScalar(toks[i].line); i++;
      const txt = parseScalar(toks[i].line); i++;
      events.push([t, txt]);
    }
    o.events = events;
  }
  return o;
}

function parseAlbumSeq(toks) {
  const arr = [];
  let cur = null;
  for (const t of toks) {
    if (t.indent !== 0) continue; // 值都在 indent 1,通过下一行读取——见下方双指针写法
  }
  // 用双指针而不是上面的占位循环
  const items = [];
  let i = 0;
  while (i < toks.length) {
    if (toks[i].line === 'id:') {
      if (cur) items.push(cur);
      cur = {};
      i++;
      cur.id = parseScalar(toks[i].line); i++;
    } else if (toks[i].line === 'meta:') {
      i++; cur.meta = parseScalar(toks[i].line); i++;
    } else if (toks[i].line === 'cap:') {
      i++; cur.cap = parseScalar(toks[i].line); i++;
    } else if (toks[i].line === 'overlay:') {
      i++; cur.overlay = parseScalar(toks[i].line); i++;
    } else { i++; }
  }
  if (cur) items.push(cur);
  return items;
}

function parseDilemmas(toks) {
  const items = [];
  let cur = null;
  let i = 0;
  while (i < toks.length) {
    const line = toks[i].line;
    if (line === 'id:') {
      if (cur) items.push(cur);
      cur = {}; i++;
      cur.id = parseScalar(toks[i].line); i++;
    } else if (line === 'text:') {
      i++; cur.text = parseScalar(toks[i].line); i++;
    } else if (line === 'a:' || line === 'b:') {
      const key = line[0]; i++;
      const label = parseScalar(toks[i].line); i++;
      const idxKey = parseScalar(toks[i].line); i++;
      // 第三项是 <function, 不含文案> 占位
      const fnPlaceholder = parseScalar(toks[i].line); i++;
      cur[key] = [label, idxKey, fnPlaceholder];
    } else { i++; }
  }
  if (cur) items.push(cur);
  return items;
}

function parseTraps(toks) {
  const items = [];
  let cur = null;
  let i = 0;
  while (i < toks.length) {
    const line = toks[i].line;
    if (line === 'id:') {
      if (cur) items.push(cur);
      cur = {}; i++;
      cur.id = parseScalar(toks[i].line); i++;
    } else if (line === 'line:') {
      i++; cur.line = parseScalar(toks[i].line); i++;
    } else if (line === 'detect:') {
      i++; cur.detect = parseScalar(toks[i].line); i++;
    } else if (line === 'ab:') {
      i++; cur.ab = parseScalar(toks[i].line); i++;
    } else { i++; }
  }
  if (cur) items.push(cur);
  return items;
}

function parseE5Lines(toks) {
  const arr = [];
  for (let i = 0; i < toks.length; i += 2) {
    arr.push([parseScalar(toks[i].line), parseScalar(toks[i + 1].line)]);
  }
  return arr;
}

function parseStranger(toks) {
  const o = { real: {}, bait: {} };
  let i = 0, cur = null;
  while (i < toks.length) {
    const line = toks[i].line;
    if (line === 'real:') { cur = 'real'; i++; }
    else if (line === 'bait:') { cur = 'bait'; i++; }
    else if (line === 'body:') { i++; o[cur].body = parseScalar(toks[i].line); i++; }
    else if (line === 'act:') { i++; o[cur].act = parseScalar(toks[i].line); i++; }
    else if (line === 'mark:') { i++; o[cur].mark = parseScalar(toks[i].line); i++; }
    else { i++; }
  }
  return o;
}

function parseOptions(toks) {
  const o = {};
  let i = 0, cur = null;
  const keys = ['bottle','disposalReason','reason','lastWords','attribution','pronoun'];
  while (i < toks.length) {
    const line = toks[i].line.replace(/:$/, '');
    if (keys.includes(line)) {
      cur = line; i++;
      if (line === 'pronoun') { o[cur] = parseScalar(toks[i].line); i++; }
      else {
        const arr = [];
        while (i < toks.length && !keys.includes(toks[i].line.replace(/:$/, ''))) { arr.push(parseScalar(toks[i].line)); i++; }
        o[cur] = arr;
      }
    } else i++;
  }
  return o;
}

function parseE(toks) { // evidence.E1..E5 单个
  const o = {}; let i = 0;
  while (i < toks.length) {
    const key = toks[i].line.replace(/:$/, ''); i++;
    o[key] = parseScalar(toks[i].line); i++;
  }
  return o;
}

function parseTruth(toks) { return toks.map(t => parseScalar(t.line)); }

function parseDeduce(toks) {
  // blanks: 后面重复 evi/prompt/options.../correct
  let i = 0;
  if (toks[i].line === 'blanks:') i++;
  const blanks = [];
  let cur = null;
  while (i < toks.length) {
    const line = toks[i].line;
    if (line === 'evi:') {
      if (cur) blanks.push(cur);
      cur = {}; i++; cur.evi = parseScalar(toks[i].line); i++;
    } else if (line === 'prompt:') {
      i++; cur.prompt = parseScalar(toks[i].line); i++;
    } else if (line === 'options:') {
      i++;
      const arr = [];
      while (i < toks.length && toks[i].line !== 'correct:') { arr.push(parseScalar(toks[i].line)); i++; }
      cur.options = arr;
    } else if (line === 'correct:') {
      i++; cur.correct = parseScalar(toks[i].line); i++;
    } else i++;
  }
  if (cur) blanks.push(cur);
  return { blanks };
}

function parseEncounters(toks) {
  // huntGraze: 后面重复 id/line
  let i = 0;
  if (toks[i] && toks[i].line === 'huntGraze:') i++;
  const arr = [];
  let cur = null;
  while (i < toks.length) {
    const line = toks[i].line;
    if (line === 'id:') { if (cur) arr.push(cur); cur = {}; i++; cur.id = parseScalar(toks[i].line); i++; }
    else if (line === 'line:') { i++; cur.line = parseScalar(toks[i].line); i++; }
    else i++;
  }
  if (cur) arr.push(cur);
  return { huntGraze: arr };
}

function parseEndings(toks) {
  const o = {}; let i = 0;
  const keys = ['continue','delete','tell'];
  while (i < toks.length) {
    const key = toks[i].line.replace(/:$/, '');
    if (keys.includes(key)) { i++; o[key] = parseScalar(toks[i].line); i++; }
    else i++;
  }
  return o;
}

const PARSERS = {
  'meta': parseMeta,
  'cast.companion': parseSimpleObject,
  'cast.mother': parseSimpleObject,
  'narrative.memo1': toks => parseScalar(toks[0].line),
  'narrative.recs.rec047': parseRec,
  'narrative.recs.rec012': parseRec,
  'narrative.billSms': toks => parseScalar(toks[0].line),
  'narrative.momPages': parseStringArray,
  'narrative.rouPages': parseStringArray,
  'narrative.momToldOpen': toks => parseScalar(toks[0].line),
  'narrative.momDecayReplies': parseStringArray,
  'narrative.rouInterim': toks => parseScalar(toks[0].line),
  'narrative.albumSeq': parseAlbumSeq,
  'narrative.dilemmas': parseDilemmas,
  'narrative.e5Lines': parseE5Lines,
  'narrative.stranger': parseStranger,
  'narrative.traps': parseTraps,
  'narrative.options': parseOptions,
  'evidence.E1': parseE, 'evidence.E2': parseE, 'evidence.E3': parseE, 'evidence.E4': parseE, 'evidence.E5': parseE,
  'evidence.truth': parseTruth,
  'evidence.deduce': parseDeduce,
  'endings.disposal': parseEndings,
  'encounters': parseEncounters,
};

function parseDossierBody(body) {
  const sections = splitBySection(body);
  const result = {};
  for (const [p, text] of sections) {
    const parser = PARSERS[p];
    if (!parser) continue; // 未知字段(不该发生),跳过
    const toks = tokenizeLines(text);
    if (!toks.length) continue;
    result[p] = parser(toks);
  }
  return result;
}

const dossierBodies = splitByDossier(DUMP_SRC);
const NEW = {};
for (const id of Object.keys(dossierBodies)) NEW[id] = parseDossierBody(dossierBodies[id]);

/* ---------------- 3. 合并:新稿字符串/数字覆盖,保留旧稿函数引用 ---------------- */
function mergeDilemmas(oldArr, newArr) {
  return newArr.map((nd, i) => {
    const od = oldArr[i] || {};
    const merged = { id: nd.id, text: nd.text };
    ['a', 'b'].forEach(k => {
      const nv = nd[k], ov = (od[k] || []);
      merged[k] = [nv[0], nv[1], ov[2]]; // 保留旧函数
    });
    return merged;
  });
}
function mergeTraps(oldArr, newArr) {
  return newArr.map((nt, i) => {
    const ot = oldArr[i] || {};
    const merged = { id: nt.id, line: nt.line, detect: ot.detect };
    if (nt.ab !== undefined) merged.ab = nt.ab;
    else if (ot.ab !== undefined) merged.ab = ot.ab;
    return merged;
  });
}
function mergeStranger(old, nw) {
  return {
    real: { body: nw.real.body, act: old.real.act, mark: old.real.mark },
    bait: { body: nw.bait.body, act: old.bait.act, mark: old.bait.mark },
  };
}
function mergeCastSub(old, nw) {
  // cast.mother / cast.companion: 结构一致,直接采用新稿(dial 内层同形)
  return {
    key: nw.key, label: nw.label, info: nw.info,
    dial: { name: nw.dial.name, ringMs: nw.dial.ringMs, result: nw.dial.result },
  };
}

function buildMergedDossier(id) {
  const old = CURRENT[id];
  const nw = NEW[id];
  const merged = JSON.parse(JSON.stringify(old, (k, v) => typeof v === 'function' ? '__KEEPFN__' : v));
  // 上面的 JSON 往返会丢函数引用,所以关键函数字段单独走 merge* 函数,不依赖这份深拷贝。

  const out = {
    meta: {
      id: old.meta.id,
      deceased: { name: nw.meta.deceased.name, alias: nw.meta.deceased.alias, died: nw.meta.deceased.died, cause: nw.meta.deceased.cause },
      life: null, icon: null, jurisdiction: null,
      scenarios: old.meta.scenarios,
    },
    cast: {
      companion: old.cast.companion, // 新稿未变更 AI 伴侣身份,原样保留(含函数)
      mother: mergeCastSub(old.cast.mother, nw['cast.mother']),
      contacts: old.cast.contacts,
    },
    evidence: {
      E1: nw['evidence.E1'], E2: nw['evidence.E2'], E3: nw['evidence.E3'], E4: nw['evidence.E4'], E5: nw['evidence.E5'],
      chain: old.evidence.chain,
      truth: nw['evidence.truth'],
      deduce: nw['evidence.deduce'],
    },
    threads: old.threads,
    rules: old.rules,
    encounters: nw.encounters,
    endings: { disposal: nw['endings.disposal'] },
    narrative: {
      momPages: nw['narrative.momPages'],
      momToldOpen: nw['narrative.momToldOpen'],
      options: nw['narrative.options'],
      albumSeq: nw['narrative.albumSeq'],
      rouPages: nw['narrative.rouPages'],
      rouInterim: nw['narrative.rouInterim'],
      rouPage0Recog: old.narrative.rouPage0Recog,
      stranger: mergeStranger(old.narrative.stranger, nw['narrative.stranger']),
      recs: { rec047: nw['narrative.recs.rec047'], rec012: nw['narrative.recs.rec012'] },
      billSms: nw['narrative.billSms'],
      traps: mergeTraps(old.narrative.traps, nw['narrative.traps']),
      dilemmas: mergeDilemmas(old.narrative.dilemmas, nw['narrative.dilemmas']),
      memo1: nw['narrative.memo1'],
      momDecayReplies: nw['narrative.momDecayReplies'],
      momDecayTail: old.narrative.momDecayTail,
      e5Lines: nw['narrative.e5Lines'],
    },
  };
  return out;
}

/* ---------------- 4. 序列化成 JS 源码 ---------------- */
function ser(v, ind) {
  const pad = '  '.repeat(ind);
  const pad1 = '  '.repeat(ind + 1);
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'function') return v.toString();
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    const items = v.map(x => pad1 + ser(x, ind + 1));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (!keys.length) return '{}';
    const items = keys.map(k => pad1 + (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k)) + ': ' + ser(v[k], ind + 1));
    return '{\n' + items.join(',\n') + '\n' + pad + '}';
  }
  return 'null';
}

/* ---------------- 5. 在 content.js 里定位并替换每个 DOSSIER_X 块 ---------------- */
function findBlock(src, name) {
  const startMarker = 'const ' + name + ' = {';
  const start = src.indexOf(startMarker);
  if (start < 0) throw new Error('找不到 ' + name);
  let i = start + startMarker.length - 1; // 指向那个 '{'
  let depth = 0, inStr = false, strCh = '', inTemplate = false, esc = false, inLineComment = false, inBlockComment = false;
  for (; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '/' && prev === '*') inBlockComment = false; continue; }
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === strCh) inStr = false;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { inLineComment = true; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlockComment = true; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  // i 现在指向匹配的 '}' 之后一位;后面应紧跟 ';'
  let end = i;
  if (src[end] === ';') end++;
  return { start, end };
}

let out = CONTENT_SRC;
const order = ['A','B','C','D','E','F','G','H','I','J','K','L','M'];
// 从后往前替换,避免前面替换改变后面的下标
const blocks = order.map(id => ({ id, ...findBlock(out, 'DOSSIER_' + id) }));
blocks.sort((a, b) => b.start - a.start);
for (const b of blocks) {
  const merged = buildMergedDossier(b.id);
  const newText = 'const DOSSIER_' + b.id + ' = ' + ser(merged, 1) + ';';
  out = out.slice(0, b.start) + newText + out.slice(b.end);
}

fs.writeFileSync(CONTENT_PATH, out, 'utf8');
console.log('已写入 js/content.js,共替换 13 台底本。');
