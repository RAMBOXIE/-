# 逃离AI · M2 数字原型(垂直切片)

《欲望算法:逃离AI》可玩教学局。规格:`../research/逃离AI_开发规格_v3.1.md`;内容:`../research/M1_纸面原型_失踪采样体的手机_v0.4.md`。

- 教学局固定种子,全手写文本(L0/L1),**零 LLM 依赖**——宪法 1 的架构:状态机管稀缺,LLM 是后接的渲染层。
- `js/lcd.js` 渲染器迁自 `research/M1_LCD原型`(帧缓冲/字形光栅化/失真四档/余晖)。
- 反馈遥测内建:首个结算行时延、预测命中、反应校准、违规行为、结局——回收单页可一键导出 JSON(跑测记录表的自动化)。
- A/B:控制台 `window.NO_PREDICT = true` 后重开 = 无预测组。

运行:`python -m http.server 8902` 后开 index.html。
打包单文件(发布用):`bash build.sh` → `dist/escape-ai.html`。

## 部署

`bash build.sh` 产出三份同源单文件(零外链、零依赖):

| 产物 | 用途 | 关系通道(柔柔的自由文本) |
|---|---|---|
| `dist/escape-ai.html` | 本地/自托管 | 模板池(13 条手写)|
| `dist/artifact.html` | claude.ai Artifact | 平台 `sample` 能力,观众付费 |
| `dist/site/index.html` | 静态托管(Netlify)| 后端代理 `netlify/functions/rou.js` |

**Netlify:** `netlify.toml` 已配好(publish=`dist/site`,functions=`netlify/functions`),不在 Netlify 上跑构建,直接发布本地产物:

```
netlify deploy --dir=dist/site --functions=netlify/functions --prod
```

未设 `ANTHROPIC_API_KEY` 时代理返回 501,前端**永久降级**到模板池——游戏其余部分(教学局、剧本 B、漂流瓶、断连仪式、回收进程、跨局存档、三结局)全部不依赖 LLM,照常可玩。设好 key 后重新部署即生效,无需改代码。

代理的安全设计:**人格核与状态注入在服务端**,客户端只能传玩家消息与状态标志。公开链接被扒也只能让「柔柔」说话,不能把 key 当通用 API 用。限流:每 IP 每小时 30 次 + 全站每天 2000 次。

## 自测

```
node tools/duration_audit.js    # 时长审计(会话 C+D 红线 >=24 分钟)
node tools/flow_walker.js       # 断头路/崩溃穷举 + 300 局随机游走
node tools/lint_gates.js        # 关系通道输出门禁(实测越界原文回归)
node tools/bottle_checks.js     # 漂流瓶轮换/文案纪律/存档
node tools/persona_sync.js      # 两条部署路径的人格核逐字一致
node tools/proxy_checks.js      # 后端代理降级链 + Function 输入校验
```
