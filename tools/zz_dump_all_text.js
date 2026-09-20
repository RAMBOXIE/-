"use strict";
/* 一次性工具:把 13 台底本的全部叙事字面量按"喂给哪个屏幕/哪个游戏系统"
   分组导出成可读文本,供人工核对"三万字到底写了什么、用在哪"。
   不改动任何游戏代码,纯只读导出。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const DEP_FILES = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js'];
const DEP_SRC = DEP_FILES.map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');
const SRC = fs.readFileSync(ROOT + '/js/content.js', 'utf8');
const ANCHOR = /const DOSSIER = \{ A: DOSSIER_A[^\n]*\n/;
const PATCHED = SRC.replace(ANCHOR, m => m + '  window.__ALLDOSSIERS = { A:DOSSIER_A,B:DOSSIER_B,C:DOSSIER_C,D:DOSSIER_D,E:DOSSIER_E,F:DOSSIER_F,G:DOSSIER_G,H:DOSSIER_H,I:DOSSIER_I,J:DOSSIER_J,K:DOSSIER_K,L:DOSSIER_L,M:DOSSIER_M };\n  return { __stop:true };\n');

function stubEnv(){
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  const env = { performance:{now:()=>1000}, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){cb({text:'x',kept:false});}, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env; return env;
}
const env = stubEnv();
const fn = new Function('window','document','performance','addEventListener','navigator','location','localStorage','OVERLAY','APP','AUDIO',
  '"use strict";' + DEP_SRC + ';\n' + PATCHED);
fn.call(env, env, env.document, env.performance, env.addEventListener, env.navigator, env.location, env.localStorage, env.OVERLAY, env.APP, env.AUDIO);
const D = env.__ALLDOSSIERS;

/* 字段路径 -> 玩家在哪个屏幕/系统里会读到它 */
const FIELD_MAP = [
  ['meta',                          '底本基本信息(编号/职业等,内部标识)'],
  ['cast.companion',                '通讯录 · AI伴侣资料页'],
  ['cast.mother',                   '通讯录 · 妈资料页'],
  ['narrative.memo1',               '备忘录 · 便签1'],
  ['narrative.memo2',               '备忘录 · 便签2(如有)'],
  ['narrative.recs.rec047',         '录音 · REC_047'],
  ['narrative.recs.rec012',         '录音 · REC_012'],
  ['narrative.billSms',             '消息 · 账单/工作台系统短信'],
  ['narrative.momPages',            '消息 · 妈线程(深搜滚动历史)'],
  ['narrative.rouPages',            '消息 · AI伴侣线程(深搜滚动历史)'],
  ['narrative.momToldOpen',         '妈线程 · 告知态开场'],
  ['narrative.momDecayReplies',     '妈线程 · 弱察觉衰变回复'],
  ['narrative.rouInterim',          'AI伴侣线程 · 中途插话'],
  ['narrative.albumSeq',            '相册 · 逐张配文'],
  ['narrative.dilemmas',            '中途两难事件(文本+选项)'],
  ['narrative.e5Lines',             '录音转写 · 结局揭示台词'],
  ['narrative.stranger',            '陌生号码 · 短信正文(真/饵)'],
  ['narrative.traps',               '陷阱/指令条款说明'],
  ['narrative.options',             '各类弹窗按钮文案(理由/遗言/归因/处置理由等)'],
  ['evidence.E1', '证据槽 1 名称/来源'], ['evidence.E2', '证据槽 2 名称/来源'],
  ['evidence.E3', '证据槽 3 名称/来源'], ['evidence.E4', '证据槽 4 名称/来源'],
  ['evidence.E5', '证据槽 5 名称/来源'],
  ['evidence.truth',                '案卷 · 结论核验(拼真相)正确释义'],
  ['evidence.deduce',               '案卷 · 结论核验(拼真相)题面与选项'],
  ['endings.disposal',              '处置结局文案(继续/告知/删除)'],
  ['encounters',                    '遭遇/擦肩事件文案'],
];

function getPath(obj, path){
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function walkChars(o){
  if (o == null) return 0;
  if (typeof o === 'string') return o.length;
  if (typeof o === 'function' || typeof o === 'number' || typeof o === 'boolean') return 0;
  if (Array.isArray(o)) return o.reduce((n, v) => n + walkChars(v), 0);
  if (typeof o === 'object') return Object.keys(o).reduce((n, k) => n + walkChars(o[k]), 0);
  return 0;
}
function stringify(o, indent){
  const pad = '  '.repeat(indent);
  if (o == null) return pad + String(o);
  if (typeof o === 'string') return pad + JSON.stringify(o);
  if (typeof o === 'function') return pad + '<function, 不含文案>';
  if (typeof o === 'number' || typeof o === 'boolean') return pad + String(o);
  if (Array.isArray(o)) return o.map(v => stringify(v, indent)).join('\n');
  if (typeof o === 'object') return Object.keys(o).map(k => pad + k + ':\n' + stringify(o[k], indent + 1)).join('\n');
  return pad + String(o);
}

const out = [];
out.push('全部 13 台底本叙事文案导出(只读,自动生成于 ' + new Date().toISOString().slice(0,10) + ')');
out.push('来源:js/content.js 内 DOSSIER_A ~ DOSSIER_M 常量,提取方式见 tools/zz_full_dossier_audit.js');
out.push('用途:核对"写了多少字、字都用在哪个屏幕"——纯展示,不代表最终校对稿。\n');

Object.keys(D).forEach(id => {
  const dossier = D[id];
  const totalChars = walkChars(dossier);
  out.push('='.repeat(70));
  out.push('底本 ' + id + '(' + (dossier.meta && dossier.meta.id) + ')  字面量总字数: ' + totalChars);
  out.push('='.repeat(70));
  FIELD_MAP.forEach(([path, label]) => {
    const val = getPath(dossier, path);
    if (val === undefined) return;
    const chars = walkChars(val);
    if (chars === 0) return;
    out.push('\n--- [' + label + ']  字段: ' + path + '  (' + chars + ' 字) ---');
    out.push(stringify(val, 0));
  });
  out.push('');
});

const totalAll = Object.keys(D).reduce((n, id) => n + walkChars(D[id]), 0);
out.push('='.repeat(70));
out.push('13 台底本叙事字面量合计: ' + totalAll + ' 字符');

fs.writeFileSync(ROOT + '/tools/zz_all_dossier_text_dump.txt', out.join('\n'), 'utf8');
console.log('已导出到 tools/zz_all_dossier_text_dump.txt,共 ' + out.length + ' 行,合计 ' + totalAll + ' 字符');
