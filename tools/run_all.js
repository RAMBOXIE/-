#!/usr/bin/env node
"use strict";
/* 一次性跑完全部自测门禁,任何一个非零退出都当场失败。
   npm test 调这个而不是 shell glob——避免 Windows 下 cmd.exe/bash 的语法分歧。 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dir = __dirname;

const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.js') && f !== path.basename(__filename))
  .sort();

let failed = 0;
for (const f of files){
  const p = path.join(dir, f);
  const r = spawnSync(process.execPath, [p], { stdio: 'inherit' });
  if (r.status !== 0){ failed++; console.log('\n>>> FAIL: ' + f + '\n'); }
}
console.log(failed ? ('\n' + failed + ' 个门禁失败') : '\n全部门禁通过');
process.exit(failed ? 1 : 0);
