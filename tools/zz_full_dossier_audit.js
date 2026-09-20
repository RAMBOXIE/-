"use strict";
/* D-165/D-166 追加:全项目字段级去重审计——不是查用户截图指到的那一个字段,
   是把 13 台底本的每一个字符串字段(递归展开到叶子)两两比较,揪出任何
   逐字相同或高度相似(编辑距离很近)的复用。一次性把"结构雷同/剧情雷同"
   这个类别的问题查穷,而不是等下一张截图。
   注:这是**人工复核用的报告工具**,不是 run_all.js 的硬门禁——菜单标签/
   thread id/证据槽位名这类"本来就该全底本一致"的基础设施字段永远会被扫出
   命中,不代表 bug;是否构成"雷同"要看字段本身是不是承载叙事内容,这件
   事目前只能靠人读报告判断,不能用一个数字阈值自动判定。所以脚本永远
   exit 0(被 run_all.js 的目录 glob 自动收编时不会拖垮其它真正的门禁),
   报告本身照常打印,该看还是要看。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// content.js 顶层直接引用 SAVE/LCD/ENGINE/STRANGERLLM 等其它文件定义的全局
// 常量(哪怕只是取值不调用也要这些名字存在),沿用其它 tools/*.js 门禁的
// 老办法:把全部依赖文件源码拼在一起再整体 new Function 求值。
const DEP_FILES = ['js/lcd.js','js/save.js','js/companion.js','js/grader.js','js/mom.js','js/stranger.js','js/engine.js'];
const DEP_SRC = DEP_FILES.map(f => fs.readFileSync(ROOT + '/' + f, 'utf8')).join('\n;\n');
const SRC = fs.readFileSync(ROOT + '/js/content.js', 'utf8');

// 在 "const DOSSIER = { A: DOSSIER_A, ... }" 这一行之后插入收集语句,
// 把 13 个底本常量整体导出到 window.__ALLDOSSIERS,不改变原逻辑。
const ANCHOR = /const DOSSIER = \{ A: DOSSIER_A[^\n]*\n/;
if (!ANCHOR.test(SRC)) { console.error('锚点行找不到,底本变量名或结构变了,先检查这个脚本'); process.exit(2); }
const PATCHED = SRC.replace(ANCHOR, m => m + '  window.__ALLDOSSIERS = { A:DOSSIER_A,B:DOSSIER_B,C:DOSSIER_C,D:DOSSIER_D,E:DOSSIER_E,F:DOSSIER_F,G:DOSSIER_G,H:DOSSIER_H,I:DOSSIER_I,J:DOSSIER_J,K:DOSSIER_K,L:DOSSIER_L,M:DOSSIER_M };\n  return { __stop: true };\n');
// 注:上面加了一个提前 return——CONTENT 是 `const CONTENT = (() => { ... })()` 的 IIFE,
// 我们只关心 13 个底本常量本身,提前退出省得再跑几千行渲染逻辑、还得为一堆 DOM/canvas 打桩。

function stubEnv(){
  const ctx = () => ({ imageSmoothingEnabled:false, clearRect(){}, fillRect(){}, fillText(){},
    getImageData:(x,y,w,h)=>({data:new Uint8Array(Math.max(1,w*h*4))}),
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}), putImageData(){}, drawImage(){} });
  const canvas = () => ({ width:0, height:0, getContext:()=>ctx() });
  const storage = { _m:Object.create(null), getItem(k){return k in this._m?this._m[k]:null;}, setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  const env = { performance:{now:()=>1000}, document:{getElementById:id=>id==='lcd'?canvas():null, createElement:()=>canvas()},
    localStorage:storage, addEventListener(){}, navigator:{}, location:{reload(){}},
    OVERLAY:{show(c,cb){cb({text:'x',kept:false});}, text(){}}, APP:{exportFeedback(){}}, AUDIO:{ensure(){},hiss(){},blip(){}}, HOLD:{active:false}, Math };
  env.window = env;
  return env;
}

// 依赖文件(lcd.js/save.js/.../engine.js)定义 LCD/SAVE/ENGINE/STRANGERLLM 等
// 全局,和 content.js 拼在一起整体求值,与其它 tools/*.js 门禁用的是同一套办法。
function extractDossiers(){
  const env = stubEnv();
  const fn = new Function('window','document','performance','addEventListener','navigator',
    'location','localStorage','OVERLAY','APP','AUDIO',
    '"use strict";' + DEP_SRC + ';\n' + PATCHED);
  fn.call(env, env, env.document, env.performance, env.addEventListener, env.navigator,
    env.location, env.localStorage, env.OVERLAY, env.APP, env.AUDIO);
  return env.__ALLDOSSIERS;
}

const DOSSIERS = extractDossiers();
const IDS = Object.keys(DOSSIERS);
if (IDS.length !== 13) { console.error('只取到 ' + IDS.length + ' 台底本,预期 13'); process.exit(2); }

/* ---- 递归展开每台底本为 {路径: 字符串值} 的扁平表(跳过函数、数字、布尔) ---- */
function flatten(obj, prefix, out){
  if (obj == null) return;
  if (typeof obj === 'string'){
    if (obj.trim().length >= 4) out.push([prefix, obj]);   // 太短的字符串(如 'A'/'ok')不值得比较
    return;
  }
  if (typeof obj === 'function' || typeof obj === 'number' || typeof obj === 'boolean') return;
  if (Array.isArray(obj)){
    obj.forEach((v, i) => flatten(v, prefix + '[' + i + ']', out));
    return;
  }
  if (typeof obj === 'object'){
    Object.keys(obj).forEach(k => flatten(obj[k], prefix ? prefix + '.' + k : k, out));
  }
}

const FLAT = {};
IDS.forEach(id => { const out = []; flatten(DOSSIERS[id], '', out); FLAT[id] = out; });

/* ---- 编辑距离(Levenshtein),裁剪到合理长度避免 O(n*m) 爆炸 ---- */
function lev(a, b){
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > Math.max(al, bl) * 0.5) return Math.max(al, bl); // 长度差太大,懒得精算
  const dp = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++){
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= bl; j++){
      const tmp = dp[j];
      dp[j] = a[i-1] === b[j-1] ? prev : 1 + Math.min(prev, dp[j], dp[j-1]);
      prev = tmp;
    }
  }
  return dp[bl];
}
function similarity(a, b){ const m = Math.max(a.length, b.length); return m === 0 ? 1 : 1 - lev(a, b) / m; }

/* ---- 已知允许重复的"通用短语"白名单(设计上刻意共用,不是复用问题) ----
   这些是历次决策日志(D-151/D-159/D-164)里明确记录过"保留共用"的收束句/选项。
   全字符串精确匹配才算白名单命中,不做子串豁免,免得把真正的雷同也漂白。 */
const WHITELIST = new Set([
  '够了,活着出去',
  '(笑)录这个干嘛',
]);

/* ---- 主比较:按"字段路径的形状"分组(去掉数组下标),只比较同类字段的取值 ---- */
function shapeOf(p){ return p.replace(/\[\d+\]/g, '[]'); }

const byShape = {};
IDS.forEach(id => {
  FLAT[id].forEach(([p, v]) => {
    const shape = shapeOf(p);
    (byShape[shape] = byShape[shape] || []).push({ id, path: p, v });
  });
});

/* ---- 逐字相同:按 (字段形状, 取值) 分组,组内出现 >=2 个不同底本才算一处
   复用问题——一处问题只报一行(带全部命中的底本清单),不再把 13 台底本
   两两配对膨胀成 78 行同样的话。 ---- */
const EXACT_GROUPS = [];
Object.keys(byShape).forEach(shape => {
  const byVal = {};
  byShape[shape].forEach(e => (byVal[e.v] = byVal[e.v] || []).push(e));
  Object.keys(byVal).forEach(v => {
    const entries = byVal[v];
    const distinctIds = [...new Set(entries.map(e => e.id))];
    if (distinctIds.length < 2) return;
    if (WHITELIST.has(v)) return;
    EXACT_GROUPS.push({ shape, v, ids: distinctIds.sort(), entries });
  });
});
EXACT_GROUPS.sort((a, b) => b.ids.length - a.ids.length || a.shape.localeCompare(b.shape));

/* ---- 高相似未逐字相同:同形状字段里,凡是取值不同但相似度达标的一对,
   用并查集把互相"够像"的值聚成一簇,一簇报一行,同样避免配对膨胀。 ---- */
const SIM_THRESHOLD = 0.82;
const NEAR_GROUPS = [];
Object.keys(byShape).forEach(shape => {
  // 按取值去重(同一底本同一取值只留一条代表),值不同才需要互相比较
  const uniqByVal = {};
  byShape[shape].forEach(e => { if (!uniqByVal[e.v]) uniqByVal[e.v] = []; uniqByVal[e.v].push(e); });
  const vals = Object.keys(uniqByVal);
  if (vals.length < 2) return;
  const parent = vals.map((_, i) => i);
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (i, j) => { const ri = find(i), rj = find(j); if (ri !== rj) parent[ri] = rj; };
  for (let i = 0; i < vals.length; i++){
    for (let j = i + 1; j < vals.length; j++){
      if (similarity(vals[i], vals[j]) >= SIM_THRESHOLD) union(i, j);
    }
  }
  const clusters = {};
  vals.forEach((v, i) => (clusters[find(i)] = clusters[find(i)] || []).push(v));
  Object.values(clusters).forEach(vs => {
    if (vs.length < 2) return;
    const allIds = new Set();
    vs.forEach(v => uniqByVal[v].forEach(e => allIds.add(e.id)));
    if (allIds.size < 2) return;   // 全部命中都在同一台底本内部(比如两处措辞相近但都属于同一台),不算跨底本复用
    NEAR_GROUPS.push({ shape, values: vs.map(v => ({ v, ids: [...new Set(uniqByVal[v].map(e => e.id))] })), idCount: allIds.size });
  });
});
NEAR_GROUPS.sort((a, b) => b.idCount - a.idCount || a.shape.localeCompare(b.shape));

/* ---- 汇总输出 ---- */
console.log('\n=== 逐字相同(跨底本,按 字段+取值 去重后): ' + EXACT_GROUPS.length + ' 组 ===\n');
EXACT_GROUPS.forEach(g => {
  console.log('[' + g.ids.length + '台: ' + g.ids.join(',') + ']  ' + g.shape);
  console.log('  ' + JSON.stringify(g.v));
});

console.log('\n=== 高相似未逐字相同(相似度 >= ' + SIM_THRESHOLD + ',按簇汇总): ' + NEAR_GROUPS.length + ' 组 ===\n');
NEAR_GROUPS.forEach(g => {
  console.log('[涉及 ' + g.idCount + ' 台]  ' + g.shape);
  g.values.forEach(x => console.log('  ' + x.ids.join(',') + ': ' + JSON.stringify(x.v)));
});

const totalHits = EXACT_GROUPS.length + NEAR_GROUPS.length;
console.log('\n字段形状总数: ' + Object.keys(byShape).length +
  ' | 逐字复用组: ' + EXACT_GROUPS.length + ' | 高相似复用组: ' + NEAR_GROUPS.length);

// 报告工具,不是硬门禁(见文件头注释)——永远 exit 0,不拖垮 run_all.js。
process.exit(0);
