# 逃离AI · M2 数字原型(垂直切片)

《欲望算法:逃离AI》可玩教学局。规格:`../research/逃离AI_开发规格_v3.1.md`;内容:`../research/M1_纸面原型_失踪采样体的手机_v0.4.md`。

- 教学局固定种子,全手写文本(L0/L1),**零 LLM 依赖**——宪法 1 的架构:状态机管稀缺,LLM 是后接的渲染层。
- `js/lcd.js` 渲染器迁自 `research/M1_LCD原型`(帧缓冲/字形光栅化/失真四档/余晖)。
- 反馈遥测内建:首个结算行时延、预测命中、反应校准、违规行为、结局——回收单页可一键导出 JSON(跑测记录表的自动化)。
- A/B:控制台 `window.NO_PREDICT = true` 后重开 = 无预测组。

运行:`python -m http.server 8902` 后开 index.html。
打包单文件(发布用):`bash build.sh` → `dist/escape-ai.html`。

## 部署

首次:`npm i`(装 esbuild,只在本地构建时用)。之后每次改动:`bash build.sh`
(或 `npm run build`),产出三份同源产物:

| 产物 | 用途 | 关系通道(柔柔的自由文本) |
|---|---|---|
| `dist/escape-ai.html` | 本地/自托管 | 模板池(13 条手写)|
| `dist/artifact.html` | claude.ai Artifact | 平台 `sample` 能力,观众付费 |
| `dist/site/index.html` | 静态托管(Netlify)| 后端代理 `netlify/functions/rou.js` |

`dist/site` 会额外**加固**:剥掉人格核与调试钩子(这条路径上它们一行都跑不到,
留着只是把全剧谜底和存档改写权明文发出去)、`esbuild --minify` 去注释与重命名。
build.sh 若加固没生效会直接非零退出,不会悄悄发一份没加固的产物。

**首次部署(你现在要做的):**

```bash
cd C:/Xtrader/escape-ai
netlify login                         # 只需一次,浏览器授权
netlify deploy --prod --no-build   --dir=dist/site --functions=netlify/functions   --site-name=<挑一个全局唯一的名字>
```

**必须在 `C:/Xtrader/escape-ai` 目录下执行**——`--dir`/`--functions` 按当前
目录解析,换个目录跑会解析到别处。命令会顺手建站,拿到
`https://<site-name>.netlify.app`。

未设 `ANTHROPIC_API_KEY` 时代理返回 501,前端**永久降级**到模板池——游戏
其余部分(教学局、剧本 B、漂流瓶、断连仪式、回收进程、跨局存档、三结局)
全部不依赖 LLM,照常可玩。想让柔柔真的读同事的话:

```bash
netlify env:set ANTHROPIC_API_KEY <你的key>
netlify env:set AWS_LAMBDA_JS_RUNTIME nodejs22.x --scope functions   # 见下方"已知限制"
netlify deploy --prod --no-build --dir=dist/site --functions=netlify/functions
```

**想用便宜模型(DeepSeek / Kimi / 通义 / OpenRouter / Groq / 本地 vLLM …):**
不改代码,只设环境变量。它们都兼容 OpenAI 的 `/chat/completions`:

```bash
netlify env:set LLM_PROVIDER openai
netlify env:set LLM_API_KEY  <你的key>
netlify env:set LLM_BASE_URL https://api.deepseek.com/v1   # 该服务接口根地址(不含路径)
netlify env:set LLM_MODEL    deepseek-chat                 # 模型名
netlify deploy --prod --no-build --dir=dist/site --functions=netlify/functions
```

不设 `LLM_PROVIDER` 就是默认的 Anthropic 路径。可选 `LLM_MAX_TOKENS`(默认 150)。
安全姿态两条路一致:人格核在服务端、`messages` 只装对话、输出过 lint、HMAC 签名。
支出硬上限去对应服务商控制台给这把 key 设——限流只挡突发,不是账务级配额。

**之后改内容重新上线,固定两步:**

```bash
bash build.sh
netlify deploy --prod --no-build --dir=dist/site --functions=netlify/functions
```

**安全设计**:人格核与状态注入**只在服务端**,走 Messages API 的顶层
`system` 参数(不是塞进 `messages[0]`——那样合并逻辑会把玩家的第一句续写到
铁律末尾,等于把设定的最后一行交给了对方)。客户端只能传玩家消息、状态
标志、以及服务端此前签过名的柔柔回复(HMAC 校验,防止伪造"她已经答应过
不演了"这类 assistant-turn 越狱)。同源限制 + Content-Type 校验双保险,
杜绝第三方页面借你的 key 跑量。限流:每 IP 每小时 30 次 + 全站每天 2000
次(`ROU_DAY_MAX` 可调)——这挡的是突发刷量,不是账务级配额,**真正的硬
上限请去 Anthropic 控制台给这把 key 设支出限额**。

**已知限制**:Netlify Functions 的 Node 运行时版本无法通过 `netlify.toml`
钉定(该字段是 no-op),只能在站点设置或用上面那条 `env:set` 命令指定。
限流计数器是 Lambda 实例内存,serverless 横向扩容时各实例各算各的——够
挡「一个人手滑刷新」,挡不住有意为之的分布式请求;这也是为什么账务上限
必须落在 Anthropic 那边,不能只靠这里的计数器。

## 自测

```
npm test                        # 跑 tools/ 下全部门禁,任何一个非零就整体失败
```

单独跑某一个:

```
node tools/duration_audit.js    # 时长审计(会话 C+D 红线 >=24 分钟)
node tools/flow_walker.js       # 断头路/崩溃穷举 + 300 局随机游走
node tools/lint_gates.js        # 关系通道输出门禁(实测越界原文回归)
node tools/bottle_checks.js     # 漂流瓶轮换/文案纪律/存档
node tools/persona_sync.js      # 两条部署路径的人格核逐字一致
node tools/proxy_checks.js      # 后端代理越狱防护/签名/限流/输入校验
node tools/wipe_checks.js       # 抹除终端确认屏(误触不清档,3 次才到确认)
```
