#!/usr/bin/env node
"use strict";
/* 人格核一致性校验:js/companion.js(浏览器/Artifact 路径)与
   netlify/functions/rou.js(静态托管代理路径)必须逐字相同。
   两处漂移 = 同一个玩家在两条部署路径上遇到两个不同的柔柔。
   顺带校验 stateLines 的注入行也一致,以及秘匿参数没有泄进任一处。 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* 从形如  const CORE = [ '...', '...' ].join('\n')  的块里取出字符串字面量 */
function extractLines(src, marker){
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const j = src.indexOf('].join', i);
  if (j < 0) return null;
  return src.slice(i, j).split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith("'"))
    .map(l => l.replace(/^'/, '').replace(/',?$/, ''));
}
function extractFn(src, name){
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  /* D-123 修:两条部署路径缩进不一样——companion.js 的 stateLines 套在一层 IIFE 里,
     闭合花括号缩进 2 格;rou.js 的是顶层函数,闭合花括号缩进 0 格。原来只找
     '\n  }' 一种,在 rou.js 上会跳过真正的闭合括号,一路扫到后面不相干的代码块
     (这次新增 CORE_B/CORE_C 后暴露:误把它们的文案也当成 stateLines 的一部分)。
     两种缩进都找,取先出现的那个。 */
  const j2 = src.indexOf('\n  }', i);
  const j0 = src.indexOf('\n}', i);
  const j = [j2, j0].filter(x => x >= 0).sort((a, b) => a - b)[0];
  if (j == null) return null;
  return src.slice(i, j).replace(/\s+/g, ' ').trim();
}

let fail = 0;
const A = (ok, msg) => { if (!ok){ fail++; console.log('X ' + msg); } else console.log('OK ' + msg); };

const cli = read('js/companion.js');
const fn  = read('netlify/functions/rou.js');
const grd = read('js/grader.js');
const mom = read('js/mom.js');
const stg = read('js/stranger.js');

function compareCore(label, srcA, markerA, srcB, markerB){
  const coreA = extractLines(srcA, markerA);
  const coreB = extractLines(srcB, markerB);
  A(coreA && coreA.length > 5, '能取出 ' + label + ' 客户端 CORE(' + (coreA ? coreA.length : 0) + ' 行)');
  A(coreB && coreB.length > 5, '能取出 ' + label + ' 服务端 CORE(' + (coreB ? coreB.length : 0) + ' 行)');
  if (coreA && coreB){
    const same = coreA.length === coreB.length && coreA.every((l, i) => l === coreB[i]);
    if (!same){
      const n = Math.max(coreA.length, coreB.length);
      for (let i = 0; i < n; i++)
        if (coreA[i] !== coreB[i]) console.log('   ' + label + ' 差异 @' + i + '\n     client: ' + coreA[i] + '\n     server: ' + coreB[i]);
    }
    A(same, label + ' 两处 CORE 逐字一致');
  }
}
/* 柔柔:companion.js CORE ↔ rou.js CORE */
compareCore('柔柔', cli, 'const CORE = [', fn, 'const CORE = [');
/* 如愿(machine#2)/阿澄(machine#3):companion.js CORE_B/CORE_C ↔ rou.js CORE_B/CORE_C(D-123) */
compareCore('如愿', cli, 'const CORE_B = [', fn, 'const CORE_B = [');
compareCore('阿澄', cli, 'const CORE_C = [', fn, 'const CORE_C = [');
compareCore('长忆', cli, 'const CORE_D = [', fn, 'const CORE_D = [');
compareCore('知遇', cli, 'const CORE_E = [', fn, 'const CORE_E = [');
compareCore('均分', cli, 'const CORE_F = [', fn, 'const CORE_F = [');
compareCore('留声', cli, 'const CORE_G = [', fn, 'const CORE_G = [');
compareCore('拟真', cli, 'const CORE_H = [', fn, 'const CORE_H = [');
/* 采样官:grader.js CORE ↔ rou.js GRADER_CORE(D-101 块3) */
compareCore('采样官', grd, 'const CORE = [', fn, 'const GRADER_CORE = [');
/* 妈告知态:mom.js CORE ↔ rou.js MOM_CORE(D-103) */
compareCore('妈告知态', mom, 'const CORE = [', fn, 'const MOM_CORE = [');
/* 妈告知态(machine#2/#3):mom.js CORE_B/CORE_C ↔ rou.js MOM_CORE_B/MOM_CORE_C(D-123) */
compareCore('妈告知态-B', mom, 'const CORE_B = [', fn, 'const MOM_CORE_B = [');
compareCore('妈告知态-C', mom, 'const CORE_C = [', fn, 'const MOM_CORE_C = [');
compareCore('妈告知态-D', mom, 'const CORE_D = [', fn, 'const MOM_CORE_D = [');
compareCore('妈告知态-E', mom, 'const CORE_E = [', fn, 'const MOM_CORE_E = [');
compareCore('妈告知态-F', mom, 'const CORE_F = [', fn, 'const MOM_CORE_F = [');
compareCore('妈告知态-G', mom, 'const CORE_G = [', fn, 'const MOM_CORE_G = [');
compareCore('妈告知态-H', mom, 'const CORE_H = [', fn, 'const MOM_CORE_H = [');
/* 陌生人:stranger.js CORE ↔ rou.js STRANGER_CORE(D-104 块3) */
compareCore('陌生人', stg, 'const CORE = [', fn, 'const STRANGER_CORE = [');

const slA = extractFn(cli, 'stateLines');
const slB = extractFn(fn,  'stateLines');
A(!!slA && !!slB, '两处都有 stateLines');
if (slA && slB){
  /* 服务端多一层 slice 防注入,只比对注入的句子本身 */
  const sent = s => (s.match(/'[^']{6,}'/g) || []).filter(x => !/^'(状态|他)/.test(x) === false);
  const a = sent(slA).join('|'), b = sent(slB).join('|');
  A(a === b, '两处状态注入句一致' + (a === b ? '' : '\n     client: ' + a + '\n     server: ' + b));
}

/* 秘匿参数不得出现在任一处(反审讯机的物理隔离) */
const SECRET = ['03:00', '03:14', '03:31', '03:45', '溯源', '判定', '掉落', '缓存格', '25%', '78%'];
[['companion.js', cli], ['rou.js', fn]].forEach(([name, src]) => {
  const persona = src.slice(src.indexOf('const CORE'), src.indexOf('const POOL') > 0 ? src.indexOf('const POOL') : src.indexOf('/* ---- 限流'));
  const hit = SECRET.filter(w => persona.includes(w));
  A(hit.length === 0, name + ' 的人格核+注入区不含秘匿参数' + (hit.length ? ' —— 命中: ' + hit.join(', ') : ''));
});
/* 采样官人格区(grader.js CORE→TAUNT 之前 / rou.js GRADER_CORE→graderState 结束) */
{
  const gp = grd.slice(grd.indexOf('const CORE'), grd.indexOf('const TAUNT'));
  const hit = SECRET.filter(w => gp.includes(w));
  A(hit.length === 0, 'grader.js 采样官人格核+注入区不含秘匿参数' + (hit.length ? ' —— 命中: ' + hit.join(', ') : ''));
}
/* 妈告知态人格区(mom.js CORE→TOLD 之前) */
{
  const mp = mom.slice(mom.indexOf('const CORE'), mom.indexOf('const TOLD'));
  const hit = SECRET.filter(w => mp.includes(w));
  A(hit.length === 0, 'mom.js 妈告知态人格核不含秘匿参数' + (hit.length ? ' —— 命中: ' + hit.join(', ') : ''));
}
/* rou.js 的妈告知态人格区(MOM_CORE/MOM_CORE_B/MOM_CORE_C,D-123 补:原本的服务端
   扫描区间只到「限流」标记就截止,GRADER_CORE/MOM_CORE/STRANGER_CORE 这些排在
   限流小节之后的人格核此前从没被这道秘匿扫描照过——这次往 rou.js 加 MOM_CORE_B/C
   顺手把这条服务端专属的老缺口补上,GRADER_CORE/STRANGER_CORE 的对应缺口仍在,
   记一笔留给后续)。 */
{
  const rmp = fn.slice(fn.indexOf('const MOM_CORE = ['), fn.indexOf('const MOM_CRISIS'));
  const hit = SECRET.filter(w => rmp.includes(w));
  A(hit.length === 0, 'rou.js 妈告知态人格区(MOM_CORE/_B/_C)不含秘匿参数' + (hit.length ? ' —— 命中: ' + hit.join(', ') : ''));
}
/* 陌生人人格区(stranger.js CORE→BODY 之前) */
{
  const sp = stg.slice(stg.indexOf('const CORE'), stg.indexOf('const BODY'));
  const hit = SECRET.filter(w => sp.includes(w));
  A(hit.length === 0, 'stranger.js 陌生人人格核不含秘匿参数' + (hit.length ? ' —— 命中: ' + hit.join(', ') : ''));
}

console.log(fail ? ('\nFAILED: ' + fail) : '\nPERSONA IN SYNC');
process.exit(fail ? 1 : 0);
