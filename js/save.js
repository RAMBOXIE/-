"use strict";
/* ============================================================================
   跨局持久(localStorage;artifact 独立 origin;一切 try/catch 容错)
   字段规格:M2_剧本B_数字切片规格_v0.2 §0
   ============================================================================ */
const SAVE = (() => {
  const KEY = 'escape_ai_save';
  function load(){
    try {
      const s = localStorage.getItem(KEY);
      return s ? JSON.parse(s) : null;
    } catch(_){ return null; }
  }
  function store(o){ try { localStorage.setItem(KEY, JSON.stringify(o)); } catch(_){} }
  function clear(){ try { localStorage.removeItem(KEY); } catch(_){} }
  return { load, store, clear };
})();
