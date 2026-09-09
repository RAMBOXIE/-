"use strict";
/* ============================================================================
   非-diegetic 玩家偏好(D-108 自查:M28 §3.10 point5「她的通道一键永久关断」/
   附录A「玩家对她依恋过深」对策)。

   纪律:
   - 这是**福祉阀门**,不是游戏机制。开关本身不涉及剧情、不产生代价、不经过
     任何角色的嘴——绝不用她的嗓音执行冷却(M28 原文)。所以它活在 HTML 外壳里
     (index.html 的 .brand 常驻栏),不是 LCD 画面里的一个"游戏内选项"。
   - 存在独立于游戏存档的 localStorage key,"抹除此终端"(清档)不应该悄悄把它
     重新打开——关断是玩家对自己福祉的选择,清档清的是叙事进度,不是这个。
   - 只做一件事:关断后 COMPANION.reply 永不被调用。不影响其余四个 LLM 面
     (采样官/妈/陌生人/picker 都是任务/剧情必经节点,不适用这条福祉阀门)。
   ============================================================================ */
const PREFS = (() => {
  const KEY = 'escape_ai_prefs';
  let state = { rouOff: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw){ const j = JSON.parse(raw); if (j && typeof j === 'object') state = Object.assign(state, j); }
  } catch(_){}
  function save(){ try { localStorage.setItem(KEY, JSON.stringify(state)); } catch(_){} }
  return {
    get rouOff(){ return !!state.rouOff; },
    setRouOff(v){ state.rouOff = !!v; save(); }
  };
})();
