"use strict";
/* 存档 schema 版本号(D-108 自查:跨版本字段漂移应报错降级,不静默错配)门禁。
   证明:①store 盖 sv=当前版本;②sv 一致→原样读回;③无 sv 的旧档(引入版本号之前)
   仍被接受(不误伤现网玩家);④sv 不一致(未来真实迁移)→弃档返回 null(不静默错配);
   ⑤非对象/坏 JSON → null。先用未修复代码验证会报警,再信它。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const SAVE_SRC = fs.readFileSync(ROOT + '/js/save.js', 'utf8');

let failures = 0;

function boot(seed){
  const m = Object.create(null);
  if (seed) for (const k in seed) m[k] = seed[k];
  const storage = { _m:m, getItem(k){return k in this._m?this._m[k]:null;},
    setItem(k,v){this._m[k]=String(v);}, removeItem(k){delete this._m[k];} };
  const env = { localStorage: storage, console: { warn(){}, log(){} } };
  env.window = env; env.__c = S => { env.S = S; };
  new Function('window','localStorage','console', '"use strict";'+SAVE_SRC+';window.__c(SAVE);')
    .call(env, env, storage, env.console);
  return { SAVE: env.S, storage };
}

function scenario(name, fn){
  const errs = [];
  try { fn({ A:(c,m)=>{ if(!c) errs.push(m); } }); }
  catch(e){ errs.push('异常: '+e.message+' @ '+((e.stack||'').split('\n')[1]||'').trim()); }
  if (errs.length){ failures++; console.log('X ['+name+']'); errs.forEach(e=>console.log('   - '+e)); }
  else console.log('OK ['+name+']');
}

scenario('store · 盖当前 schema 版本号', ({A}) => {
  const { SAVE, storage } = boot();
  SAVE.store({ runCount: 3 });
  const raw = JSON.parse(storage._m['escape_ai_save']);
  A(raw.sv === SAVE.SCHEMA_VERSION, 'store 应盖 sv=当前版本,实际 ' + raw.sv);
  A(raw.runCount === 3, '原字段应保留');
});

scenario('load · sv 一致原样读回', ({A}) => {
  const { SAVE } = boot();
  SAVE.store({ runCount: 5, lastGrade: 'praise' });
  const o = SAVE.load();
  A(o && o.runCount === 5 && o.lastGrade === 'praise', '同版本应完整读回,实际 ' + JSON.stringify(o));
});

scenario('load · 无 sv 的旧档仍接受(不误伤现网玩家)', ({A}) => {
  const { SAVE } = boot({ escape_ai_save: JSON.stringify({ runCount: 2, history: [{ cacheVal: 1 }] }) });
  const o = SAVE.load();
  A(o && o.runCount === 2, '版本号之前的存档应被接受(其结构即当前 v1),实际 ' + JSON.stringify(o));
});

scenario('load · sv 不一致(未来迁移)→ 弃档返回 null,不静默错配', ({A}) => {
  const { SAVE } = boot({ escape_ai_save: JSON.stringify({ sv: 999, runCount: 7 }) });
  const o = SAVE.load();
  A(o === null, '跨版本存档应被弃用返回 null(而非拿旧结构喂新代码),实际 ' + JSON.stringify(o));
});

scenario('load · 坏 JSON / 非对象 → null', ({A}) => {
  A(boot({ escape_ai_save: '{坏的' }).SAVE.load() === null, '坏 JSON 应 null');
  A(boot({ escape_ai_save: '[1,2]' }).SAVE.load() === null, '数组应 null');
  A(boot({ escape_ai_save: 'null' }).SAVE.load() === null, "'null' 应 null");
  A(boot().SAVE.load() === null, '无存档应 null');
});

console.log(failures ? ('\nFAILED: '+failures) : '\nALL SAVE-SCHEMA CHECKS PASS');
process.exit(failures ? 1 : 0);
