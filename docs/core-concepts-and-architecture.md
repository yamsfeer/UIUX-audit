# 核心概念与架构设计

本文档定义 UI/UX Audit 工具的核心概念、整体架构和执行流程。面向后续开发者和维护者，阅读本文即可理解系统全貌。

---

## 1. 整体流程

工具的执行管线是严格的五阶段顺序流程：

```
                        ┌──────────────┐
                        │  起始 URL     │
                        │  (用户提供)    │
                        └──────┬───────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │      Journey ?       │
                    │  (可选：登录/前置脚本) │
                    └──────────┬──────────┘
                               │
                ┌──────────────┼──────────────┐
                │ 无 Journey    │              │ 有 Journey
                │               │              ▼
                │               │   ┌─────────────────────┐
                │               │   │ 执行 YAML/JS 步骤    │
                │               │   │ goto → fill → click │
                │               │   │ → wait → assert     │
                │               │   └──────────┬──────────┘
                │               │              │
                │               │              ▼
                │               │   ┌─────────────────────┐
                │               │   │ 导出 storageState   │
                │               │   │ (cookies +          │
                │               │   │  localStorage)      │
                │               │   └──────────┬──────────┘
                │               │              │
                └──────────────┼──────────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │     Explore          │
                    │  (自动发现页面和状态)  │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │  Programmatic Check  │
                    │  对每个 State 执行    │
                    │  accessibility+layout│
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │    Visual Review     │
                    │  视觉模型审核截图     │
                    └──────────┬──────────┘
                               │
                               ▼
                    ┌─────────────────────┐
                    │      Report          │
                    │  汇总所有问题输出报告  │
                    └─────────────────────┘
```

**入口文件:** `src/runner.ts:62` `runAudit()` 函数，代码中可直接追溯各阶段。

| 阶段 | 触发条件 | 产出 |
|---|---|---|
| Journey | `config.journey` 非空 | `storageState`（cookies + localStorage） |
| Explore | `config.explore = true` | `ExplorationResult`（含 `PageState[]`） |
| Programmatic Check | 始终执行（除非 `--no-a11y` / `--no-layout`） | `CheckResult[]` |
| Visual Review | `config.visual = true` | 视觉问题列表，合并入 `CheckResult[]` |
| Report | 始终执行 | JSON / Markdown / Table 格式报告 |

---

## 2. 核心概念定义

### 2.1 State（页面状态）

**State 是 Explore 的产出物，代表特定 URL 上的一个唯一 UI 形态。**

类型定义在 `src/explore/types.ts:32-39`：

```typescript
interface PageState {
  url: string;              // 当前页面 URL
  stateId: string;          // 唯一标识 = pathname+query::domHash前12位
  description: string;       // 人类可读标签（来自 h1 或 title）
  interactions: Interaction[]; // 到达此状态所需的交互序列
  domHash: string;          // DOM 指纹（SHA-256）
  screenshot?: string;      // 截图路径
}
```

**关键认知：State ≠ URL。** 同一个 URL 可以对应多个 State。判断依据是 `stateId`，其构成为：

```
stateId = pathname + query + "::" + domHash前12位
```

见 `src/explore/dedup.ts:36-40` `computeStateId()`。DOM 变化即产生新 State，无论 URL 是否变化：

- 打开/关闭弹窗 → 新 State
- 切换 Tab → 新 State
- 展开下拉菜单 → 新 State
- 填写表单后 DOM 局部刷新 → 新 State

可以将 State 理解为"页面的一个 UI 快照版本"。

### 2.2 Explore（自主探索）

**Explore 是自动浏览网站、发现所有可达 State 的 BFS 搜索引擎。**

核心实现在 `src/explore/explorer.ts:27-179` `Explorer` 类。它的工作方式：

1. 从种子 URL 出发，放入优先级队列
2. 导航到目标 URL，截图 + 计算 domHash
3. 对未见过的 State 进行记录
4. 提取页面上的链接和可交互元素
5. AI（可选）对交互候选排序优先级
6. **试探交互**：点击 → 检查是否产生新 State → **回溯恢复**
7. 发现的新 URL 和新交互目标入队
8. 循环直到预算耗尽或队列为空

Explore 有两个互补的子模式：

| 维度 | 无 AI | 有 AI（默认） |
|---|---|---|
| 交互排序 | 确定性启发式（导航栏 > 弹窗触发 > 普通按钮） | AI 语义理解优先级 |
| 交互数量 | 最多取前 10 个候选 | AI 精选最多 5 个 |
| 页面探索完整性 | BFS 穷举 | AI 判断是否"已探索完毕"可提前终止 |

### 2.3 Journey（前置脚本）

**Journey 是在 Explore 之前执行的用户定义脚本，用于建立浏览器上下文（主要是认证）。**

类型定义在 `src/journey/types.ts:5-28`。支持两种形式：

**YAML 格式**（声明式）：
```yaml
name: "登录流程"
viewport:
  width: 1440
  height: 900
steps:
  - goto: "/login"
  - fill:
      selector: "#email"
      value: "admin@test.com"
  - click: "button[type=submit]"
  - waitForNavigation: ""
  - assert:
      url: "/dashboard"
```

**JS 格式**（编程式）：
```typescript
// 可访问完整 Playwright Page API
async (ctx: JourneyContext) => {
  await ctx.page.goto(ctx.resolveUrl('/login'));
  // ... 复杂逻辑
  return ['/extra-page-1', '/extra-page-2'];  // 可选：返回额外页面供审计
}
```

Journey 不产生 State，只产生：
- `storageState`：完整的 cookies + localStorage 快照（Playwright `BrowserContext.storageState()` 格式）
- `auditPages`（可选）：JS Journey 可返回额外需要审计的页面 URL

**Journey 最常见的用途是登录，但不限于此**——任何需要前置操作的场景（表单预填、筛选条件设置、多步导航）都可以用它。

### 2.4 Interaction（交互）

**Interaction 描述了从当前 UI 状态过渡到另一个状态所需的一个用户操作。**

类型定义在 `src/explore/types.ts:1-7`：

```typescript
interface Interaction {
  type: 'navigate' | 'click' | 'toggle-state' | 'submit-form' | 'fill-input';
  selector: string;
  value?: string;     // 仅 fill-input 使用
  label: string;      // 人类可读标签
  priority: number;   // 0-1 优先级
}
```

在 Explore 中，交互有两个角色：
1. **作为路径**：记录在 `PageState.interactions` 中，表示"要复现此 State 需要执行哪些交互"
2. **作为探索目标**：放入队列的 `interact` 类型目标，驱动探索继续发现新 State

---

## 3. Explore 内部循环

Explore 是整个系统最复杂的模块。以下是其内部的行为树：

```
                        ┌─────────────────────────┐
                        │  输入: storageState      │
                        │  初始种子 URL            │
                        │  预算: maxPages /        │
                        │  maxStates / maxDepth    │
                        └────────────┬────────────┘
                                     │
                                     ▼
                        ┌─────────────────────────┐
                        │    初始化优先级队列       │
                        │  queue = [navigate(种子)] │
                        │  visited = Set()          │
                        └────────────┬────────────┘
                                     │
                                     ▼
                          ┌─────────────────────┐
                          │   队列为空?           │
                          │   或预算耗尽?         │
                          └──────────┬──────────┘
                                     │
                     ┌───────────────┼───────────────┐
                     │ 否                            │ 是
                     ▼                               ▼
        ┌──────────────────────┐          ┌─────────────────────┐
        │ 从队列取出下一个目标   │          │    探索结束          │
        │ (按优先级排序)        │          │  输出 ExplorationResult│
        └──────────┬───────────┘          │  · PageState[]       │
                   │                      │  · SiteMap           │
                   ▼                      │  · Stats             │
        ┌──────────────────────┐          └─────────────────────┘
        │ 目标类型?             │
        │ (ExplorationTarget)  │
        └──────────┬───────────┘
                   │
        ┌──────────┼──────────┐
        │ navigate             │ interact
        ▼                      ▼
  ┌──────────────┐    ┌──────────────────────────┐
  │ 导航到新 URL  │    │ 在当前页面上执行交互       │
  │ page.goto()  │    │ (click / toggle / fill)   │
  └──────┬───────┘    └────────────┬─────────────┘
         │                         │
         ▼                         ▼
  ┌──────────────────────────────────────────┐
  │          截图 + 计算 domHash              │
  │  生成 stateId = path+query::hash[:12]    │
  └────────────────────┬─────────────────────┘
                       │
                       ▼
            ┌─────────────────────┐
            │  stateId 在 visited  │
            │  集合中? (去重)      │
            └──────────┬──────────┘
                       │
        ┌──────────────┼──────────────┐
        │ 是 (已见过)                  │ 否 (新 State!)
        ▼                              ▼
  ┌──────────────┐          ┌─────────────────────────┐
  │ 跳过, continue │          │ 记录 PageState:          │
  └──────────────┘          │ · url, stateId,          │
                            │   description,           │
                            │   screenshot             │
                            │ visited.add(stateId)     │
                            │ stats.statesDiscovered++ │
                            └────────────┬─────────────┘
                                         │
                            ┌────────────┴────────────┐
                            │                         │
                            ▼                         ▼
              ┌─────────────────────┐   ┌──────────────────────────┐
              │ 提取链接 (Layer 1)   │   │ AI 判断页面探索完毕?       │
              │ extractLinks()      │   │ aiGuide.isPageExplored()  │
              │                     │   │ 若是 → 跳过后续交互提取    │
              │ <a href> → LinkCandidate │   │ (仅在 aiGuided=true)  │
              │ 过滤: 同源 / 去重   │   └──────────────────────────┘
              │ 新链接 → 入队 navigate│
              └─────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────────┐
              │ 提取可交互元素 (Layer 1)          │
              │ extractInteractions()           │
              │                                 │
              │ 选择器覆盖:                      │
              │  button, [role=button]          │
              │  [aria-haspopup], [data-modal]  │
              │  [role=tab], [aria-expanded]    │
              │  input, select, textarea        │
              │  [onclick], [tabindex]>=0       │
              │                                 │
              │ 安全过滤:                        │
              │  avoidDestructive → 排除 delete │
              │  avoidForms → 排除 submit/form  │
              │  仅保留可见元素                  │
              └────────────┬────────────────────┘
                           │
                           ▼
              ┌─────────────────────┐
              │   AI 引导排序?        │
              │   (aiGuided: true    │
              │    且 AI 已配置)      │
              └──────────┬──────────┘
                         │
         ┌───────────────┼───────────────┐
         │ 是                            │ 否
         ▼                               ▼
  ┌─────────────────────────┐  ┌─────────────────────────┐
  │ AI 对候选评分排序         │  │ 确定性启发式排序          │
  │ aiGuide.prioritize()    │  │                         │
  │                         │  │ 导航栏元素: priority=0.9 │
  │ 考虑因素:               │  │ toggle-state:  0.7      │
  │  · 语义理解按钮含义      │  │ navigate:      0.8      │
  │  · 识别核心导航结构      │  │ 普通 click:    0.5      │
  │  · 避开危险/破坏性操作   │  │ submit-form:   0.3      │
  │  · 优先可能产生新状态的  │  │ fill-input:    0.3      │
  │                         │  │                         │
  │ 结果: 最多取前 5 个      │  │ 结果: 最多取前 10 个     │
  └────────────┬────────────┘  └────────────┬────────────┘
               │                            │
               └──────────────┬─────────────┘
                              │
                              ▼
              ┌─────────────────────────────┐
              │  逐个"试探"交互:              │
              │  probeInteraction()         │
              │                             │
              │  1. 记录当前快照             │
              │     (url, scrollX, scrollY) │
              │  2. 执行 click/fill/toggle  │
              │  3. waitForTimeout(300)     │
              │  4. 截图 + 计算 domHash     │
              │  5. 比对 stateId 是否新     │
              │  6. 回溯恢复 (finally 块)    │
              │     · goBack 或 goto 原 URL │
              │     · 按 Escape 关闭弹窗    │
              └────────────┬────────────────┘
                           │
               ┌───────────┼───────────┐
               │ 产生新 State │          │ 未产生新 State
               ▼                        │
  ┌──────────────────────────┐         │
  │ 新交互目标入队             │         │
  │ queue.push({             │         │
  │   type: 'interact',      │         │
  │   url: currentUrl,       │         │
  │   interaction: candidate │         │
  │ })                       │         │
  └──────────────────────────┘         │
               │                        │
               └────────────┬───────────┘
                            │
                            ▼
                     回到循环顶部
                     (检查队列/预算)
```

核心实现在 `src/explore/explorer.ts`:

| 方法 | 行号 | 职责 |
|---|---|---|
| `explore(startUrl)` | 48-179 | 主循环：出队 → 导航 → 截图 → 去重 → 提取 → 试探 |
| `probeInteraction()` | 181-219 | 试探单次交互，检测是否产生新 State，然后回溯 |
| `capturePageState()` | 231-261 | 截图并构造 PageState 对象 |
| `executeInteraction()` | 264-285 | 执行单次交互操作 |
| `getBudget()` | 222-228 | 计算剩余预算 |

---

## 4. 关键设计机制

### 4.1 domHash 去重

`src/explore/dedup.ts:4-34` `computeDomHash()`

```
页面 DOM
  │
  ├─ 克隆 body
  ├─ 移除 script, style, svg, noscript, link
  ├─ 移除动态属性: data-csrf, nonce, data-token, style,
  │                及含 "timestamp" / "ts" 的属性
  ├─ 提取 innerText，折叠空白字符
  │
  └─ SHA-256 哈希 → 64 位 hex 字符串
```

`stateId = pathname + query + "::" + domHash前12位`

**为什么是文本哈希而非结构哈希？** 因为文本变化是 UI 状态变化的最可靠信号。一个弹窗出现/消失，文本内容必然改变。而 DOM 结构可能因广告、动态时间戳等因素漂移。

**为什么取前 12 位？** 前 12 位 hex 提供约 2^48 的碰撞空间，足以区分同一网站上的所有 UI 状态，同时保持 stateId 可读。

### 4.2 回溯 (Backtrack)

`src/explore/explorer.ts:181-219` `probeInteraction()` 中的 `finally` 块。

试探交互的核心约束是：**不能改变当前状态**，否则后续的交互候选都基于错误的前提。回溯策略：

1. 如果交互导致 URL 变化 → `page.goBack()` 回到原 URL
2. 如果 `goBack` 失败或 URL 仍不一致 → `page.goto(原URL)` 强制跳回
3. 按 Escape 键关闭可能的弹窗/浮层
4. 如果仍不在预期 URL → 再次 `goto` 兜底
5. 整个过程在 `finally` 块中，确保即使交互崩溃也会恢复

### 4.3 AI 排序 vs 确定性排序

在 `src/explore/dom-extractor.ts:77-220` 中，`extractInteractions()` 返回交互候选并附带确定性优先级：

```
导航栏元素 (inNav=true)       → priority=0.9
navigate 类型 (链接)          → priority=0.8
toggle-state 类型 (弹窗/菜单)  → priority=0.7
普通 click                    → priority=0.5
submit-form / fill-input      → priority=0.3
```

当 AI 启用时（`src/explore/ai-guide.ts`），AI 会替换此排序：

- **输入**：页面截图 + 所有交互候选列表 + 当前预算
- **AI 决策**：语义理解每个按钮/链接的功能，评估其产生新 State 的可能性
- **输出**：排序后的交互列表（最多 5 个）
- **额外能力**：`isPageExplored()` 方法可判断页面是否"已探索完整"，提前终止避免无效交互

区别在于：确定性排序只看"标签类型"，AI 排序理解"这个按钮是干什么的"。

### 4.4 预算控制

`src/explore/types.ts:54-65` 默认配置 + `src/explore/types.ts:116-121` Budget 接口：

| 参数 | 默认值 | 作用 |
|---|---|---|
| `maxPages` | 30 | 最多访问的不同 URL 数量 |
| `maxStates` | 50 | 最多发现的 State 数量 |
| `maxDepth` | 5 | URL 路径深度上限（防止无限递归） |
| `maxInteractions` | 200 | 最多试探的交互次数 |
| `timeoutMs` | 300_000 (5min) | 探索总时间上限 |

在 `explorer.ts:62-66` 的主循环入口每次检查预算。还有 `getBudget()` 方法（行 222-228）将剩余预算传递给 AI，让 AI 据此调整探索策略。

### 4.5 storageState 贯穿

Journey 产出的 `storageState` 在整个管线中传递：

- `runner.ts:81` Journey 产出后存储
- `runner.ts:141` 创建 BrowserContext 时注入：`browser.newContext({ storageState })`
- `runner.ts:166` 检查 State 时，每个 State 的新 Context 也注入
- `runner.ts:238` 截图捕获同样注入

这意味着 **Journey 产出的登录态在 Explore、Check、Visual Review 所有阶段都生效**。用户只需配置一次 Journey，全流程自动携带认证。

### 4.6 State 复现

在审计阶段（`runner.ts:159-201`），要对 Explore 发现的每个 State 执行检查。复现 State 的方法是：

```
1. page.goto(ps.url)                     // 导航到该 State 的 URL
2. replayInteractions(ps.interactions)    // 按顺序重放交互序列
3. 此时页面处于该 State 的 UI 形态
4. 运行 accessibility / layout 检查
```

`replayInteractions()` 在 `runner.ts:35-59`，它按 `Interaction.type` 分发到对应的 Playwright 操作。

---

## 5. 具体示例

以 `~/autorun-harness-dashboard/audit-results/report.json` 中的一次实际审计为例：

### 探索结果

```
种子 URL: http://localhost:5173/

Explore 统计:
  pagesDiscovered: 2
  statesDiscovered: 4
  interactionsAttempted: 6
  aiDecisionsMade: 8
  durationMs: 185070
```

### 探索路径

```
种子 URL: http://localhost:5173/
│
├─[navigate]→ / (首页)
│   │ stateId: /::00dbf2215faa → 新 State! "项目列表"
│   │
│   ├─[extract links]→ /projects/771fa7c2 → 入队 navigate
│   │
│   └─[probe: click "添加项目"按钮]
│       │ domHash 变化 → 新 State!
│       │ stateId: /::b8102155b6f6 → "项目列表 (弹窗打开)"
│       │ 入队该 State 供后续检查
│       └─ 回溯 → 弹窗关闭，回到原始首页
│
├─[navigate]→ /projects/771fa7c2-... (洁邻管家)
│   │ stateId: /projects/771fa7c2::1f2607082d93 → 新 State! "洁邻管家"
│   │
│   └─[probe: click "评估报告" tab]
│       │ domHash 变化 → 新 State!
│       │ stateId: /projects/771fa7c2::09009480db81 → "洁邻管家 (评估报告)"
│       │ 入队该 State
│       └─ 回溯 → 回到看板视图
│
└─ 队列耗尽 → 探索结束
```

### 审计结果

| 层级 | 问题数 | 说明 |
|---|---|---|
| Accessibility | 17 | 全部为 color-contrast（设计系统固有取舍） |
| Layout | 48 | 以 overflow-x, small-touch-target, element-overlap 为主 |
| Visual | 42 | 视觉模型对照设计规范发现的偏离 |

各 State 的问题分布（`stateIssues`）：
```
/::00dbf2215faa → 13 issues
/projects/771fa7c2::09009480db81 → 20 issues
/::b8102155b6f6 → 19 issues
```

---

## 6. 数据流和类型关系

```
                     AuditConfig                    (src/checks/types.ts:57-79)
                    ┌──────────┐
                    │ url      │
                    │ journey? │──→ Journey 文件路径
                    │ explore? │──→ 启用 Explore
                    │ visual?  │──→ 启用 Visual Review
                    │ ...      │
                    └────┬─────┘
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
    Journey (可选)   Explore (可选)  Visual Review (可选)
    ┌──────────┐   ┌─────────────┐  ┌──────────────┐
    │JourneyConfig│ │ExplorationConfig│ │DesignSpec    │
    │  steps[]    │ │  maxPages     │ │ (Markdown)   │
    │  viewport   │ │  maxStates    │ └──────┬───────┘
    └─────┬──────┘ │  aiGuided     │        │
          │        └──────┬───────┘        │
          ▼               │                │
    JourneyResult         │                │
    ┌──────────────┐      │                │
    │ storageState │──────┼────────────────┤
    │ auditPages?  │      │                │
    └──────────────┘      ▼                │
                   ExplorationResult        │
                   ┌────────────────┐       │
                   │ pageStates[]   │───────┤
                   │  · PageState   │       │
                   │  · stateId     │       │
                   │  · interactions│       │
                   │  · domHash     │       │
                   │  · screenshot  │       │
                   │ siteMap        │       │
                   │ stats          │       │
                   └───────┬────────┘       │
                           │                │
                           ▼                │
                   Programmatic Checks      │
                   ┌────────────────┐       │
                   │ accessibility  │       │
                   │ layout         │       │
                   └───────┬────────┘       │
                           │                │
                           ▼                ▼
                      CheckResult[]   Visual Issues
                      ┌──────────────────────┐
                      │ Issue[]              │
                      │  · type              │
                      │  · severity          │
                      │  · selector          │
                      │  · fixSuggestion     │
                      └──────────┬───────────┘
                                 │
                                 ▼
                           AuditReport       (src/checks/types.ts:22-42)
                           ┌────────────────────┐
                           │ url                │
                           │ timestamp          │
                           │ results[]          │
                           │ summary            │
                           │  · total           │
                           │  · critical/warning│
                           │  · byCheck         │
                           │ exploration?       │
                           │  · statesDiscovered│
                           │  · stateIssues     │
                           │  · screenshots[]    │
                           └────────────────────┘
```

---

## 7. 关键源文件索引

| 文件 | 职责 |
|---|---|
| `src/runner.ts` | 顶层编排器，协调五个阶段 |
| `src/explore/types.ts` | PageState, Interaction, ExplorationConfig 等类型定义 |
| `src/explore/explorer.ts` | Explorer 类，BFS 探索核心算法 |
| `src/explore/dedup.ts` | domHash 计算 + StateRegistry 去重 |
| `src/explore/dom-extractor.ts` | DOM 解析，提取链接和交互候选 |
| `src/explore/ai-guide.ts` | AI 驱动的交互排序和页面探索判断 |
| `src/explore/runner.ts` | Explore 的顶层启动器 |
| `src/explore/site-map.ts` | 站点地图树构建 + Journey YAML 生成 |
| `src/journey/types.ts` | JourneyStep, JourneyConfig, JourneyResult 类型定义 |
| `src/journey/executor.ts` | Journey 步骤执行引擎 |
| `src/journey/runner.ts` | Journey 顶层启动器 |
| `src/checks/types.ts` | Issue, CheckResult, AuditConfig, AuditReport 类型定义 |
| `src/checks/accessibility.ts` | axe-core 无障碍检查 |
| `src/checks/layout.ts` | 程序化布局检查 |
| `src/visual/screenshot.ts` | 截图捕获 |
| `src/visual/reviewer.ts` | 视觉模型审查 |
| `src/visual/design-spec.ts` | 设计规范加载器 |
| `src/report/formatter.ts` | JSON/Markdown/Table 报告输出 |
| `docs/autonomous-explorer-design.md` | 探索器架构设计文档（中文） |
| `docs/autonomous-explorer-implementation-plan.md` | 探索器 6 阶段实现计划（中文） |
