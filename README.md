# 逃离AI · M2 数字原型(垂直切片)

《欲望算法:逃离AI》可玩教学局。规格:`../research/逃离AI_开发规格_v3.1.md`;内容:`../research/M1_纸面原型_失踪采样体的手机_v0.4.md`。

- 教学局固定种子,全手写文本(L0/L1),**零 LLM 依赖**——宪法 1 的架构:状态机管稀缺,LLM 是后接的渲染层。
- `js/lcd.js` 渲染器迁自 `research/M1_LCD原型`(帧缓冲/字形光栅化/失真四档/余晖)。
- 反馈遥测内建:首个结算行时延、预测命中、反应校准、违规行为、结局——回收单页可一键导出 JSON(跑测记录表的自动化)。
- A/B:控制台 `window.NO_PREDICT = true` 后重开 = 无预测组。

运行:`python -m http.server 8902` 后开 index.html。
打包单文件(发布用):`bash build.sh` → `dist/escape-ai.html`。
