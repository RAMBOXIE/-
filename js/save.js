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
  function load(){
    try {
      const s = localStorage.getItem(KEY);
      if (!s) return null;
      const o = JSON.parse(s);
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      if (o.sv === undefined) return o;                 // 版本号之前的存档=当前结构,接受
      if (o.sv !== SCHEMA_VERSION){                     // 真实跨版本:弃档从头开始,不静默错配
        try { console.warn('[save] 存档版本 ' + o.sv + ' ≠ 当前 ' + SCHEMA_VERSION + ',已弃用旧档,重新开始'); } catch(_){}
        return null;
      }
      return o;
    } catch(_){ return null; }
  }
  function store(o){
    try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, o, { sv: SCHEMA_VERSION }))); } catch(_){}
  }
  function clear(){ try { localStorage.removeItem(KEY); } catch(_){} }
  return { load, store, clear, SCHEMA_VERSION };
})();
