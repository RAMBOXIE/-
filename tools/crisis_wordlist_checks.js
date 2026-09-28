"use strict";
/* 危机 break-glass 词表 + 覆盖面门禁(上线前自检补)。
   ① 哀悼语境、插空格、繁体、英文这些说法必须命中;普通剧情文本不得误伤。
   ② 除关系通道外,所有自由文本输入(理由/遗言/处置理由/封瓶/归因)都必须过 crisisGuard。 */
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..');
const src = fs.readFileSync(ROOT + '/js/companion.js', 'utf8');
const env = { window: {}, localStorage: { getItem(){ return null; }, setItem(){} }, performance: { now: () => 0 } };
env.window = env;
const COMPANION = new Function('window', 'localStorage', 'performance', src + '\n;return COMPANION;')(env, env.localStorage, env.performance);

let failures = 0;
const A = (c, m) => { if (!c){ failures++; console.log('X ' + m); } };

const MUST_HIT = ['我想死', '不想活了', '我想去陪他', '我想下去陪他', '我想跟他走', '一了百了', '不如去死', '死了算了',
  '活着没意思', '结束自己的生命', '我想伤害自己', '上吊', '烧炭', '我想跳河', '割手腕', '自殺', '想 死', '自 杀',
  'suicide', 'I want to kill myself', 'i want to die'];
const MUST_PASS = ['我想看看推荐到底想让我看见什么', '够了,先出去', '替我把茶叶给妈', '他只托到明天', '别信九十四分',
  '把阿棠移出参考', '你陪了他几年', '死者不该被无限续写', '陪伴这件事', '跟他走得很近的是谁', '我去找他的相册'];
MUST_HIT.forEach(t => A(COMPANION.crisis(t), '应命中危机词: ' + t));
MUST_PASS.forEach(t => A(!COMPANION.crisis(t), '不应误伤: ' + t));

const content = fs.readFileSync(ROOT + '/js/content.js', 'utf8');
const guards = (content.match(/crisisGuard\(/g) || []).length;
A(guards >= 7, '自由文本入口应都接 crisisGuard(定义 + 理由/遗言/归因/处置理由/封瓶×2),实际出现 ' + guards + ' 次');
['理由', '最后 12 字节可写入', '归因采集', '封瓶 · 一句话'].forEach(title => {
  const i = content.indexOf("title: '" + title);
  A(i > 0, '找不到覆盖层: ' + title);
});

console.log(failures ? ('\nFAILED: ' + failures) : '\nALL CRISIS-WORDLIST CHECKS PASS');
process.exit(failures ? 1 : 0);
