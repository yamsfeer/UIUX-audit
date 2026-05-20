# How It Works — uiux-audit 功能现状与缺口

这是一个自动化 UI/UX 质量审计工具，用于对网站进行多层次的质量检查。主要功能：

## 三层审计

1. 无障碍检查 (Accessibility) — 基于 axe-core，检测标签、ARIA、对比度、标题顺序等约 90 条规则
2. 布局检查 (Layout) — 程序化 DOM 检测：文本溢出、元素重叠、触控目标过小、视口外元素、零尺寸元素等
3. 视觉审查 (Visual) — 可选，通过视觉模型分析截图，检测对齐、间距、层级、设计规范偏差等

## 核心特性

- 多视口支持 — 可同时检查桌面和移动端（如 `--viewport 1440x900,375x812`）
- Journey 自动化 — 用 YAML/JS 文件定义登录等前置步骤，支持环境变量替换
- 站点探索 (Explore) — 自主发现页面和状态，支持 AI 引导或纯 DOM 模式
- 设计规范合规 — 用 `--design-spec` 传入 Markdown 设计文档，对比截图找偏差
- 多格式输出 — json / markdown / table，可输出到文件或目录
- AI Agent 集成 — JSON 输出结构化，适合 Agent 循环修复：审计 → 读报告 → 修复 → 重新审计
- 多模型支持 — 默认火山引擎 Doubao-Seed-2.0-pro，也兼容 OpenAI、Azure 等兼容接口
- CJK 字体支持 — 设置 `locale: 'zh-CN'` 确保中文渲染正确

---

## 1. Journey 的目的：不只是登录

Journey 返回的是 `storageState`（cookies + localStorage），然后所有后续的浏览器上下文都继承这个状态。所以登录是最常见的用例，但不是唯一：

- 登录 — 最典型
- 填充购物车 — 审计结账页面
- 修改设置 — 审计某个特定配置下的状态
- JS Journey 还能返回 `auditPages` — 告诉工具"登录后审计这些页面"

但本质上它就是一个预置状态机，目的就是"让浏览器进入某个特定状态"。它不会参与审计本身的逻辑，审计开始后 Journey 就结束了。

---

## 2. Explore：DOM 模式 vs AI 模式，以及能不能提供引导文件

### DOM 模式 (`--no-explore-ai`)

DOM 模式不调用任何 AI 模型，纯粹靠 DOM 启发式规则来决定探索什么：

- `dom-extractor.ts:199-204` — 导航链接优先级 0.9，弹窗类 0.7，内容链接 0.8，表单 0.3
- 不截屏，不发 API，零成本
- 每页取优先级最高的 12 个交互（AI 模式取 8 个但更精准）

AI 模式则截屏发给视觉模型，让模型区分"结构性导航"（tab、侧边栏、弹窗触发器）和"内容重复项"（列表卡片、分页），优先探索前者。这是 DOM 模式做不到的判断。

### 能不能像 Journey 一样提供引导文件？

目前不支持。探索是完全自主的，没有"探索指令文件"的概念。但有一个逆向的能力：

`--explore-journey <path>` 可以把探索结果导出为 Journey YAML。流程是：

1. 先跑一次 `--explore`，导出 Journey
2. 后续审计用 `--journey` 重放这些路径

这解决了"已知网站结构，不需要重新探索"的场景，但不能提前告诉 AI "我的网站有这些页面、这些交互逻辑"。

### 业界最佳实践

在 UX 审计/测试领域，常见的做法是：

| 做法 | 代表工具 | 本项目对应 |
|------|---------|-----------|
| 爬虫式自主发现 | OWASP ZAP Spider, Burp Suite | `--explore`（DOM 模式） |
| AI 引导探索 | 本项目独有 | `--explore`（AI 模式） |
| 手动定义页面清单 | Playwright test suites, Cypress | `--pages /a,/b,/c` |
| 录制回放 | Playwright Codegen, Cypress Studio | `--journey` |
| 状态快照复用 | Playwright `storageState` | Journey 的 `storageState` |
| 设计规范合规 | Percy, Applitools, Chromatic | `--design-spec` |

业界没有"给爬虫一个网站地图"的标准做法，但安全扫描工具通常支持 seed URLs（种子 URL 列表），这相当于你说的"告知网站有哪些内容"。本项目目前只有 `--pages` 能做类似的事，但它不能描述交互逻辑。

---

## 3. AI Agent 集成：纯 CLI，无 Skill/MCP

集成方式是纯 CLI 调用 + JSON 输出，没有任何 Skill、MCP 或 API 集成。README 描述的循环是：

1. Agent 启动 dev server
2. Agent 运行: `uiux-audit http://localhost:PORT --output json --output-dir /tmp/audit-results`
3. Agent 读取 `/tmp/audit-results/<timestamp>/report.json`
4. Agent 用 `selector` + `fixSuggestion` 修复代码
5. 重新运行审计
6. 直到 `critical` / `warning` 归零

Agent 依赖的是 JSON 报告的结构化字段：`results[].issues[].selector` 定位代码，`fixSuggestion` 指导修复。这就是全部的集成面——没有 MCP server，没有 Skill 文件，没有 SDK。

---

## 总结：三个特性的现状和缺口

| 特性 | 现状 | 缺口 |
|------|------|------|
| Journey | 预置浏览器状态（登录/设置），JS 版可返回待审计页面 | 不能描述"交互逻辑全景"，只能做线性步骤 |
| Explore | 自主爬站，AI 或 DOM 两种模式，可导出 Journey | 没有种子文件/网站地图输入，不能提前告知网站结构 |
| Agent 集成 | 纯 CLI + JSON，Agent 自行解析 | 无 MCP/Skill，Agent 需要自己实现调用-解析-修复循环 |


## 整体架构

uiux-audit 是一个自动化 UI/UX 质量审计工具，对网站进行三层检查：

| 层级 | 方式 | 成本 | 检测内容 |
|------|------|------|----------|
| Accessibility | axe-core 程序化检查 | 无 | 标签、ARIA、对比度、标题顺序等约 90 条规则 |
| Layout | 自定义 DOM 检查 | 无 | 文本溢出、元素重叠、触控目标过小、视口外元素、零尺寸元素等 |
| Visual | 视觉模型分析截图 | 有（需 API Key） | 对齐、间距、层级、设计规范偏差等 |

核心特性还包括：多视口支持、Journey 自动化、站点探索（Explore）、设计规范合规、多格式输出。

---

## 三大核心特性：现状与缺口

### 1. Journey 自动化

**现状：** Journey 用于在审计前预置浏览器状态。它执行一系列步骤（goto、fill、click、wait 等），完成后保存 `storageState`（cookies + localStorage），后续所有浏览器上下文都继承这个状态。

支持两种格式：
- **YAML Journey** — 声明式步骤定义
- **JS Journey** — 编程式，可返回 `auditPages` 告知工具审计哪些页面

典型用例：
- 登录后审计需要认证的页面
- 填充购物车后审计结账流程
- 修改设置后审计特定配置下的状态

**本质：** Journey 是一个预置状态机——"让浏览器进入某个特定状态"。审计开始后 Journey 就结束了，它不参与审计本身。

**缺口：**
- 只能做线性步骤，不能描述"交互逻辑全景"
- 不能表达条件分支（如"如果出现弹窗则关闭"）
- 与 Explore 之间只有单向导出（Explore → Journey），没有反向输入

### 2. Explore 站点探索

**现状：** 面对未知网站时，自主发现页面和交互状态。两种模式：

| 模式 | 行为 | 成本 |
|------|------|------|
| AI 引导（默认） | 截屏发给视觉模型，区分"结构性导航"和"内容重复项"，优先探索前者 | 有 |
| DOM 模式（`--no-explore-ai`） | 纯 DOM 启发式规则（导航链接 0.9、弹窗类 0.7、内容链接 0.8、表单 0.3），不截屏不发 API | 无 |

探索机制：
- 维护待访问队列（链接导航 + 交互触发）
- 通过 DOM hash 和 layout hash 去重，避免重复访问相同结构的页面
- `probeInteraction` — 先试探交互，检查是否产生新状态，然后回溯恢复原状态
- AI 模型有三个决策点：优先级排序、页面是否探索完毕、表单填充策略

输出能力：
- `--explore-output` — 导出探索地图（JSON）
- `--explore-journey` — 导出为 Journey YAML，供后续回放

**缺口：**
- 不支持种子文件/网站地图输入，不能提前告知网站结构
- 不支持用户故事/业务流程作为输入来引导探索方向
- 探索是"广度优先发现"，不是"沿业务路径深度检查"
- AI 引导的判断基于截图和 DOM，不理解业务语义

### 3. AI Agent 集成

**现状：** 纯 CLI 调用 + JSON 输出，没有任何 Skill、MCP 或 API 集成。

集成循环：
```
1. Agent 启动 dev server
2. Agent 运行: uiux-audit http://localhost:PORT --output json --output-dir /tmp/audit-results
3. Agent 读取 /tmp/audit-results/<timestamp>/report.json
4. Agent 用 selector + fixSuggestion 修复代码
5. 重新运行审计
6. 直到 critical/warning 归零
```

Agent 依赖的是 JSON 报告的结构化字段：`results[].issues[].selector` 定位代码，`fixSuggestion` 指导修复。

**缺口：**
- 无 MCP Server，Agent 需要自己实现调用-解析-修复循环
- 无 Skill 文件，无法在 Claude Code 等环境中直接调用
- 无 SDK，无法编程式集成
- 报告是快照式的，没有增量对比能力（"上次 5 个问题，这次修了 3 个"）

---

## 关键讨论：Explore 的业务流程引导

### 问题

当前 Explore 是"我不知道这个网站有什么"的解法——自主爬站，尽可能触达更多页面和状态。但现实中的 UX 审计往往需要的是"我知道业务应该怎么走，帮我检查这条路走不走得通"。

AI 自主探索能发现 tab 切换有问题，但它永远不会知道"下单→选地址→付款→确认"这条链路中间哪一步的 UX 有问题。用户提供业务流程，让工具模拟真实用户操作并逐步审计，才是更贴合业务逻辑的检测方式。

### 改进方向：从纯自主到纯引导的光谱

| 模式 | 输入 | 行为 | 现状 |
|------|------|------|------|
| 纯自主 | 只给 URL | AI/DOM 自主爬站 | 已实现（`--explore`） |
| 种子引导 | sitemap / URL 列表 | 沿已知路径探索，每页交互仍自主发现 | 未实现 |
| 流程引导 | 用户故事 / 状态机 / 业务流程 YAML | 按业务流程逐步执行，每一步都做审计 | 未实现 |
| 纯回放 | Journey YAML | 按步骤回放，不探索 | 已实现（`--journey`） |

**流程引导**是核心场景。与 Journey 的关键区别：Journey 是"到达状态"，执行完就结束；流程引导是"边走边查"——每一步都停下来检查当前页面的 a11y、layout、visual，然后才走下一步。

### 流程引导的输入示例

```yaml
name: 下单流程
flows:
  - name: 用户下单
    steps:
      - goto: /products
      - click: .product-card:first-child
      - click: button.add-to-cart
      - click: a.checkout
      - fill: { selector: input[name="address"], value: "测试地址" }
      - click: button.place-order
    assert: { url: /order-confirmation }
```

### 业界参考

| 做法 | 代表工具 | 本项目对应 |
|------|---------|-----------|
| 爬虫式自主发现 | OWASP ZAP Spider, Burp Suite | `--explore`（DOM 模式） |
| AI 引导探索 | 本项目独有 | `--explore`（AI 模式） |
| 手动定义页面清单 | Playwright test suites, Cypress | `--pages /a,/b,/c` |
| 录制回放 | Playwright Codegen, Cypress Studio | `--journey` |
| 状态快照复用 | Playwright `storageState` | Journey 的 `storageState` |
| 设计规范合规 | Percy, Appliteyes, Chromatic | `--design-spec` |
| 种子 URL / sitemap 驱动 | 安全扫描工具常见 | 未实现 |
| 业务流程驱动审计 | 无先例 | 待实现 |
