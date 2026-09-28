"use strict";
/* ============================================================================
   跨局持久(localStorage;artifact 独立 origin;一切 try/catch 容错)
   字段规格:M2_剧本B_数字切片规格_v0.2 §0
   ============================================================================ */
const SAVE = (() => {
  const KEY = 'escape_ai_save';
  /* D-108 自查:存档此前无 schema 版本号,跨版本字段漂移会被静默错配(而非报错降级)。
     现在 store 盖 sv;load 时:无 sv=引入版本号之前的存档(其结构即当前 v1,接受);
     sv 与当前不一致=跨了一次真实结构变更,宁可弃档从头开始,也不拿旧结构去喂新代码。
     升级流程:任何一次会改变存档字段含义的改动,把 SCHEMA_VERSION +1(旧档即被安全弃用)。 */
  const SCHEMA_VERSION = 1;
  /* D-171:字段级类型校验。篡改/损坏的存档不该让开机黑屏——类型不对的字段退回
     "从没写过"(数组→[],标量/对象→删掉),数组里类型不对的元素滤掉。
     dossierId 的取值白名单在 content.js(DOSSIER_ORDER),这里只管类型。 */
  const ARR_STR = ['evidence', 'seenThreads', 'recsA', 'seenBottles', 'returnedRelics', 'disposalHistory', 'worldArc'];
  const ARR_OBJ = ['history', 'predsA', 'predsB'];
  const NUM = ['runCount', 'dossierCycle', 'lastCacheVal', 'praiseCount', 'forgedSeen', 'crisisSeen',
               'predictP', 'predictN', 'predictLowStreak'];
  const STR = ['dossierId', 'lastEnding', 'lastReason', 'lastWords', 'disposal', 'momLocked', 'lastGrade', 'lastDirective'];
  const OBJ = ['clues', 'vault', 'bottleSealed'];
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
  function normalize(o){
    ARR_STR.forEach(k => { if (k in o) o[k] = Array.isArray(o[k]) ? o[k].filter(x => typeof x === 'string') : []; });
    ARR_OBJ.forEach(k => { if (k in o) o[k] = Array.isArray(o[k]) ? o[k].filter(isObj) : []; });
    NUM.forEach(k => { if (k in o && !(typeof o[k] === 'number' && Number.isFinite(o[k]) && o[k] >= 0)) delete o[k]; });
    STR.forEach(k => { if (k in o && o[k] !== null && typeof o[k] !== 'string') delete o[k]; });
    OBJ.forEach(k => { if (k in o && o[k] !== null && !isObj(o[k])) delete o[k]; });
    return o;
  }
  /* 开机哨兵:本页第一次 load() 时布防,app.js 引导走完调 bootOk() 撤防。
     若上一次开机没走完(初始化抛错=黑屏),这次弃档从头,不让同一份坏档反复黑屏。 */
  const BOOT_KEY = 'escape_ai_booting';
  let armed = false;
  const ss = () => { try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch(_){ return null; } };
  function armBoot(){
    if (armed) return false; armed = true;
    const s = ss(); if (!s) return false;
    try {
      const crashed = s.getItem(BOOT_KEY) === '1';
      s.setItem(BOOT_KEY, '1');
      return crashed;
    } catch(_){ return false; }
  }
  function bootOk(){ const s = ss(); try { if (s) s.removeItem(BOOT_KEY); } catch(_){} }
  function load(){
    if (armBoot()){
      try { console.warn('[save] 上次开机未完成,存档可能已损坏,已重新开始'); } catch(_){}
      clear();
      return null;
    }
    try {
      const s = localStorage.getItem(KEY);
      if (!s) return null;
      const o = JSON.parse(s);
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      if (o.sv === undefined) return normalize(o);      // 版本号之前的存档=当前结构,接受
      if (o.sv !== SCHEMA_VERSION){                     // 真实跨版本:弃档从头开始,不静默错配
        try { console.warn('[save] 存档版本 ' + o.sv + ' ≠ 当前 ' + SCHEMA_VERSION + ',已弃用旧档,重新开始'); } catch(_){}
        return null;
      }
      return normalize(o);
    } catch(_){ return null; }
  }
  function store(o){
    try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, o, { sv: SCHEMA_VERSION }))); } catch(_){}
  }
  function clear(){ try { localStorage.removeItem(KEY); } catch(_){} }
  return { load, store, clear, bootOk, normalize, SCHEMA_VERSION };
})();
