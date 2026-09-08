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
  const j = src.indexOf('\n  }', i);
  return src.slice(i, j).replace(/\s+/g, ' ').trim();
}

let fail = 0;
const A = (ok, msg) => { if (!ok){ fail++; console.log('X ' + msg); } else console.log('OK ' + msg); };

const cli = read('js/companion.js');
const fn  = read('netlify/functions/rou.js');
const grd = read('js/grader.js');

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
/* 采样官:grader.js CORE ↔ rou.js GRADER_CORE(D-101 块3) */
compareCore('采样官', grd, 'const CORE = [', fn, 'const GRADER_CORE = [');

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

console.log(fail ? ('\nFAILED: ' + fail) : '\nPERSONA IN SYNC');
process.exit(fail ? 1 : 0);
