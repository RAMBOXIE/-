# 交接文档 —— 《欲望算法:逃离AI》教学局

> 面向接手的 AI agent / 开发者。读完这份 + `README.md` + `../research/逃离AI_开发规格_v3.1.md`(设计宪法)即可继续。
> 最后更新:2026-09-08。对应提交 `1a817e4`。

---

## 0. 一句话

一个**零 LLM 依赖也能完整玩**的恐怖叙事小游戏:你捡到一台失踪者的手机(诺基亚式单色 LCD 模拟),
在一个凌晨的时间窗口里翻找它的数据、决定怎么处置,同时手机里的 AI 伴侣「柔柔」在观察你。
柔柔的自由对话**可选**接 LLM(Artifact 平台能力 / Netlify 后端代理),接不上就退化成手写模板池,游戏照常。

**当前状态:已上线公网** → https://escape-the-algorithm.netlify.app
(Netlify site id 见 `.netlify/state.json`;LLM 对话未配 key,走模板池。)

---

## 1. 代码地图(必读)

```
index.html            外壳 + <style> + 6 个 <script src>
js/lcd.js             ★ LCD 渲染器:196×224 逻辑屏,Float32 帧缓冲,逐帧全量重绘
js/save.js            存档(localStorage)
js/companion.js       柔柔对话:人格核 + lint + 三级降级链(平台能力→后端代理→模板池)
js/engine.js          ★ 状态机 + 数值引擎:S(全局状态)、act()(动作结算)、判定、限流
js/content.js         ★ 57 个屏(SCREENS)+ 屏幕流 + 公共绘制(statusBar/settleLines/option/btn2)
js/app.js             启动、rAF 主循环、输入分发(键盘/触摸)、window.GAME 调试钩子
netlify/functions/rou.js   关系通道后端代理(人格核在服务端,HMAC 验签,限流)
build.sh              产物构建(见 §5)
tools/*.js            门禁测试(见 §6);npm test 自动跑全部
```

**三个核心文件读法**:`lcd.js`(怎么画)→ `engine.js`(状态怎么变)→ `content.js`(屏怎么排)。

---

## 2. 渲染模型(改视觉前必懂)

- **不是 DOM,是像素**。`lcd.js` 维护 `target`(本帧目标)和 `actual`(带余辉衰减的实际显示)两个
  `Float32Array(196*224)`。每帧 `frame(drawFn)`:清 `target` → `drawFn()` 往里画 → 向 `actual` 做余辉插值
  → `present()` 把 `actual` 映射成 RGB 写进 canvas。
- **单色磷光屏**。`present()` 里颜色是两个写死的常量:`LIT=[0x5F,0xF0,0xC8]`(亮青)与 `UNLIT`/`SUB`(暗底)。
  **目前没有任何颜色变化机制,也没有震屏机制。**
- **已有的"畸变分级"框架**:`applyTier(trace)` 按溯源值 `S.trace` 把噪点/糊字阈值/闪烁分 0~3 级
  (`R.corrupt/threshold/flicker/batJitter/tsScramble`)。**这是所有"状态越危险画面越坏"效果的现成挂载点**——
  新的视觉强化应该搭这套分级,而不是另起炉灶散落 if。
- 主循环 `js/app.js` `loop()` 用 rAF;`tickTimer()` 另用 250ms `setInterval`(后台标签页 rAF 会停)。
- 逻辑屏坐标恒为 196×224;`SCALE=3` 只在最后 `drawImage` 放大。所有绘制用逻辑坐标。

---

## 3. 屏幕状态机(改交互前必懂)

- `SCREENS[id]` = `{ enter?, leave?, render(), key(k), transient?, swipe?(dir) }`。
- 切屏:`go(id, noStack?)` / `push(id)` / `back()`。`transient:true` 的屏不进返回栈。
- `enter()` 只在切入时调一次(很多屏用 `this._t` 守卫"首次进入才结算")。`render()` 每帧调。
- 输入分发在 `content.js` 末尾的 `key(k)`:
  - `swipeUp/Down` → 若屏自带 `swipe()` 就交给它,否则转 `ArrowDown/ArrowUp`。
  - `swipeRight` → `Escape`;`swipeLeft` → 吞掉。
  - 触摸点选:`render()` 里用 `hit(x,y,w,h,key)` 注册命中区,`tap(lx,ly)` 命中后发对应 key。
- **结算行 `S.settle`**:`engine.act()` 每次动作把结算文案写进 `S.settle`(数组,数值信息永远排句首)。
  屏底用 `settleLines(y)` 或 `settleLinesCapped(y, baseY)` 渲染它。

---

## 4. 待办:用户明确要的三项视觉/交互强化

> 用户原话(2026-09-07):
> 1. 超长文字应支持**上下滑动查看**,按钮位置仍然永远不变。
> 2. 游戏目标的视觉强化要更强,例如**扣电量时震屏**等强化紧迫感的效果。
> 3. 进程/电量/信号要有更强的视觉传达,**甚至可以考虑颜色变化**。

### 背景:上一次布局修复(已提交 `1a817e4`)

四个屏(相册 `album` / 漂流瓶 `bottleIn` / 采样协议 `th_proto` / 拨号结果 `dialing`)原本把底部按钮
钉死在 `H-常量`,内容一长就压字。修法是**按钮固定不动 + `settleLinesCapped()` 把挤不下的结算行尾巴截掉**
(数值信息在句首不会被截)。截断是当时的临时取舍——**用户的诉求①正是要把"截断"换成"可滚动"。**

### ① 可滚动的长文本(替换掉截断)

- **方案**:给这几个屏(以及任何长文屏)加一个滚动偏移 `this.scroll`(行数或像素),`render()` 里从
  `scroll` 起画内容、画到按钮上沿为止;`ArrowUp/ArrowDown` 加减 `scroll`(并 clamp)。**按钮位置绝对不动**。
- **触摸**:这几个屏里 `album` 自带 `swipe()`(用来切照片),需要区分"滑动切照片"和"滑动滚文本"——
  建议长内容时上下滑滚文本、左右滑或专门按钮切照片;其余屏没占用 `swipe()`,swipeUp/Down 会自动转成
  ArrowDown/Up,基本"顺便"就有滚动。
- **已确认**这四个屏当前都没占用 `ArrowUp/ArrowDown`,可直接绑定。
- **别忘了**:滚动时要有"还有更多"的视觉提示(上/下箭头或渐隐),否则玩家不知道能滚。
- **回归**:`tools/layout_checks.js` 已断言"按钮不被压字 + 按钮不被推出 224px 画布"。加滚动后这两条仍须过;
  再补一条"内容超长时按钮 y 不变"。

### ② 震屏 / 事件强化(扣电量等)

- **无现成机制,需新增**。建议在 `lcd.js` 的 `R` 里加一个瞬时抖动状态(如 `R.shake = {mag, until}`),
  `present()` 或 `frame()` 里在 `until` 未到时给整帧一个随机 (dx,dy) 偏移(逻辑坐标平移或 drawImage 偏移)。
- **触发点**:`engine.js` `act()` 里 `cost.bat` 扣电量的分支(约 59~65 行)是天然挂载点;
  电量跌破 20%(省电模式)、回收进程抵达(`huntArrive`)、判定失败等也应各有强度不同的抖动。
- **纪律**:宪法 11「恐怖峰 ≤2 次/局」——**震屏是"紧迫感"不是"恐怖峰",要克制**,别每个小动作都晃到影响可读性。
  建议做成"电量扣除=轻微一下,回收抵达=强烈一下"的分级。
- 移动端注意:抖动不能把内容甩出可视区导致按钮点不到(参照①的 224px 约束)。

### ③ 进程/电量/信号的强化视觉传达(含颜色)

- **现状**:`statusBar()`(content.js 约 60~86 行)画日期/时钟/回收倒计时/电量/信号,全是单色;
  电量低、信号变化只有"糊字/抖动"没有"变色"。
- **颜色**:`present()` 现在硬编码单色。要上颜色,最干净的做法是让 `LIT` 颜色**可按状态覆盖**——
  例如电量 <20% 时状态栏电量段用告警色、回收进程逼近时时钟段变色。
  技术上需要 `present()` 支持"分区/分像素的颜色",这是比①②更大的改动,**建议先和用户确认颜色语言**
  (哪种状态→哪种颜色,是否只染状态栏还是全屏氛围),别自作主张铺满。
- **搭 `applyTier` 分级**:溯源越高越危险,可让整体色温/告警色随 tier 递进,和已有的噪点/闪烁同步。
- **信号**:`drawSignal()` / `sigBars()` 已有格数,可加"信号跳变时闪一下"的强调。

> ⚠️ 用户在③里说"**甚至可以**考虑颜色",语气是开放建议不是硬需求。颜色改动最大、最容易翻车,
> 上手前用一个小范围原型(先只染状态栏电量段)给用户看,而不是一次性全屏染色。

---

## 5. 构建与部署

```bash
bash build.sh
```
产出三份:
- `dist/escape-ai.html` —— 独立完整版(本地双击可玩,含 window.GAME 调试钩子)
- `dist/artifact.html` —— Artifact 平台版(去外壳标签)
- `dist/site/index.html` —— **公网静态站**。`build.sh` 会把 `[SITE-STRIP-BEGIN/END]` 之间的段整段剥掉
  (人格核明文、调试钩子),并用 IIFE 包住,防止按 F12 的人看到全剧谜底。**改完 `js/*.js` 必须重跑 build.sh**,
  否则线上产物不变。

部署(需要本地已 `netlify login`,当前 Bash 沙箱没有登录态,让用户在自己终端跑):
```bash
netlify deploy --prod --no-build --dir=dist/site --functions=netlify/functions
```
接 LLM 对话(可选):在 Netlify 控制台配 `ANTHROPIC_API_KEY`(+可选 `ROU_SIG_KEY`),
**去 Anthropic 控制台给这把 key 设支出上限**——代理的限流是实例内存,只挡突发刷量,不是账务级配额。

---

## 6. 测试门禁(改任何东西后必跑)

```bash
npm test        # = node tools/run_all.js,自动发现并跑 tools/*.js 全部门禁
```
覆盖:流程连通性(无断头路)、lint 三层、人格核双处逐字一致、后端代理安全(system 参数/HMAC/CORS/限流)、
清档手势、**布局重叠(layout_checks.js)**。全绿才提交。

**门禁教训(反复踩过)**:新增门禁必须先问"它自己会不会静默放行?"——写完新测试,故意用**未修复**的旧代码
跑一遍,确认它**真的会报警**,再信它。`layout_checks.js` 就是这么验过的。

UI 改动光跑门禁不够:用浏览器(preview 或 gstack `/browse`)真进到那个屏看一眼,尤其移动端窗口
(resize 到 ~500×900)复现用户截图的场景。浏览器面板后台会节流,渲染性能以 Node 直接测(0.35ms/帧)为准。

---

## 7. 不可协商的红线(设计宪法节选,全文见规格 §1)

- **宪法 2**:LLM 只渲染措辞,不裁决任何数值。成本/判定/掉落全在 engine/content,柔柔碰不到。
- **秘匿参数物理隔离**:活规则窗口值、判定概率、掉落表**永不出现在** companion.js / rou.js / 会送给 LLM 的任何地方。
  (`clockOf` 兜底值都特意删了,因为任何写死的时刻都会是某局窗口真值。)
- **宪法 11 恐怖三律**:界面异常+负空间,不血腥;实体不露正脸;**恐怖峰 ≤2 次/局**;LLM 无权加峰。
  → 直接约束上面 §4② 的震屏强度:紧迫感可以有,别把小动作也做成恐怖峰。
- **宪法 12/13 全 diegetic**:所有反馈用"哑机 UI"语汇,界面异常只在虚构屏幕内,不复刻宿主 OS。
  → §4③ 上颜色时别做成"系统级弹窗/浏览器告警"那种跳出虚构的样子。
- **单机完整性铁律(宪法 9)**:离线/无 LLM 必须能完整玩。任何视觉强化都不能依赖联网。

---

## 8. 手头顺手的钩子

- `window.GAME`(仅本地/artifact 版,site 版被剥掉):`GAME.go(id)` 直达任意屏、`GAME.S` 读写状态、
  `GAME.CONTENT` / `GAME.ENGINE` / `GAME.LCD`。复现某屏最快的方式:
  ```js
  GAME.go('album'); GAME.CONTENT.current.idx = 2;
  GAME.S.settle = ['特征比对·不匹配 ｜ 电量 −2 → 25% ｜ 进程掠过了你。'];
  GAME.LCD.frame(() => GAME.CONTENT.render());
  ```
- 想看某屏实际画在哪:临时劫持 `LCD.drawText`/`LCD.frameRect` 收集坐标(layout_checks.js 就是这么做的)。

---

## 9. 立刻可做的下一步

1. 跟用户敲定 §4③ 的**颜色语言**(哪种状态→哪种颜色、只染状态栏还是全屏),这是三项里风险最高的。
2. 先落 §4①(可滚动长文)——纯逻辑、有现成测试兜底、无宪法风险,最安全的起手。
3. 再落 §4②(分级震屏),搭 `act()` 的扣电量分支和 `applyTier` 分级。
4. 每步:改 `js/*.js` → `bash build.sh` → `npm test` → 浏览器移动端窗口目验 → 提交(提交信息别加 AI 署名,见用户全局 CLAUDE.md)。
