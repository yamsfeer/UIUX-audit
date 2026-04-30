# 自主探索器：AI 驱动的网站探索设计

## 问题陈述

当前的 Journey 系统要求用户手动描述与网站交互的每一个步骤（导航、填写、点击、等待）。这隐含了以下假设：

1. 用户熟悉目标网站的所有页面和交互
2. 用户有能力编写脚本（或有 AI 辅助编写）
3. 网站结构是静态可知的

实际上，许多用户希望在并不了解网站完整结构的情况下进行审计——不知道有哪些页面、会弹出什么对话框、有哪些导航路径。现有的 `--pages` 参数只能列出 URL，无法发现页面内部的状态（模态弹窗、Tab 面板、表单提交后的视图等）。

## 提案：自主探索器

一种 AI 驱动的探索模式，能够自动发现目标网站的页面和 UI 状态，生成一份全面的可审计视图列表——无需用户编写任何脚本。

### 定位

探索器是 Journey 的**互补模式**，而非替代：

| 模式 | 适用场景 | 输入 |
|------|---------|------|
| `--journey` | 用户明确知道要测试什么 | YAML/JS 脚本 |
| `--explore` | 用户希望全面覆盖网站 | 无（AI 自主决策） |
| `--explore --journey` | 需要登录的网站 | 登录脚本 + AI 探索 |

## 架构

### 执行流程

```
runAudit(config)
  |
  |-- runJourney()          // 现有功能：获取 storageState
  |-- runExplorer()         // 新增：AI 探索，产出 PageState[]
  |-- mergePages()          // 合并 --pages / journey.auditPages / explorer.pageStates
  |-- 程序化检查             // 现有管线
  |-- 视觉审查               // 现有管线
  |-- 报告                   // 现有管线
```

探索器位于 Journey 和审计管线之间。它接收已认证的浏览器上下文（如果运行了 Journey），产出一个 `PageState` 对象列表，直接注入现有的截图 + 审计流程。

### 核心数据模型

```typescript
interface PageState {
  url: string;                    // 重定向后的最终 URL
  stateId: string;                // 该状态的唯一标识（url + dom hash）
  description: string;            // 人类可读："首页"、"设置弹窗已打开"
  interactions: Interaction[];     // 到达此状态的交互序列
  domHash: string;                // 用于去重的关键 DOM 特征哈希
  screenshot?: string;            // 探索截图路径（供 AI 审查）
}

interface Interaction {
  type: 'click' | 'fill' | 'select' | 'navigate';
  selector: string;
  value?: string;                  // 用于 fill/select
  label: string;                   // 人类描述："点击'打开菜单'按钮"
}

interface ExplorationResult {
  pageStates: PageState[];
  siteMap: SiteMapNode;            // 发现的页面树结构
  stats: ExplorationStats;
}

interface ExplorationStats {
  pagesDiscovered: number;
  statesDiscovered: number;
  interactionsAttempted: number;
  aiDecisionsMade: number;
  durationMs: number;
}
```

### 探索策略：DOM + AI 混合

探索器采用两层策略：

#### 第一层：基于 DOM 的发现（确定性，无 AI 成本）

此层在每个页面上运行，不需要任何 AI 调用：

1. **链接提取**：收集所有 `<a href>` 元素，基于 URL 解析相对路径，过滤为同源链接
2. **交互元素枚举**：查找所有可点击元素——按钮、`[role="button"]`、有关联操作的输入框、`[aria-haspopup]` 触发器、`[data-modal]`、`[data-dropdown]`、`[data-overlay]`、`[tabindex]` 元素
3. **表单发现**：识别 `<form>` 元素及其提交触发器
4. **导航发现**：检测 `<nav>`、`[role="navigation"]`、侧边栏菜单、面包屑
5. **状态触发器**：可折叠区块（`details/summary`）、Tab 面板（`[role="tab"]`）、手风琴、切换按钮

输出：结构化的候选交互列表，每个包含选择器、类型和推断的用途。

#### 第二层：AI 引导优先级排序（智能，有成本）

第一层产出候选交互后，调用 AI 模型进行：

1. **优先级排序**：根据当前页面截图 + DOM 摘要，判断哪些交互最可能产生新的、有价值的 UI 状态
2. **分类**：为每个交互标注类型（导航 vs. 状态变更 vs. 破坏性操作），避免不期望的操作
3. **完成检测**：判断页面是否已被充分探索（不太可能再发现新的有意义状态）
4. **恢复**：当交互导致意外状态（错误页、重定向）时，决定是回溯还是继续

AI 接收的紧凑提示包含：
- 页面截图（仅视口区域，非整页——更省钱）
- 第一层的候选交互列表（选择器、文本内容、元素类型）
- 探索历史摘要（已访问的页面、已发现的状态）
- 剩余预算（可探索的页面/状态数）

AI 返回一个排序后的下一步操作列表。

### 探索算法

```
function explore(startUrl, config):
  queue = PriorityQueue()
  visited = Set<stateId>()
  results = []

  // 用起始 URL 播种
  queue.enqueue(startUrl, priority=1.0)

  while queue is not empty and budget remains:
    current = queue.dequeue()

    if current.stateId in visited:
      continue
    visited.add(current.stateId)

    // 导航到页面
    page.goto(current.url)
    page.waitForLoadState('networkidle')

    // 第一层：DOM 发现
    candidates = extractInteractions(page)
    links = extractLinks(page)

    // 第二层：AI 优先级排序（如启用）
    if config.aiGuided:
      ranked = aiPrioritize(page, candidates, history, budget)
    else:
      ranked = candidates  // 默认：所有候选优先级相同

    // 记录此页面状态
    results.push(currentPageState)

    // 将链接目标入队
    for link in links:
      if not visited.has(link.stateId):
        queue.enqueue(link, priority=0.7)

    // 将交互目标入队
    for interaction in ranked:
      snapshot = page.saveState()  // 保存以供回溯
      try:
        executeInteraction(page, interaction)
        newState = captureState(page)
        if newState.stateId not in visited:
          queue.enqueue(newState, priority=interaction.priority)
      finally:
        page.restoreState(snapshot)  // 始终回溯
```

### 安全与预算控制

| 控制项 | 默认值 | 用途 |
|--------|-------|------|
| `--max-pages` | 30 | 访问不同 URL 的硬上限 |
| `--max-states` | 50 | 页面状态总数（URL + DOM）的硬上限 |
| `--max-depth` | 5 | 从起始 URL 的最大导航深度 |
| `--max-interactions` | 200 | 每次会话最大交互尝试次数 |
| `--explore-timeout` | 300s | 探索的挂钟时间限制 |
| `--stay-on-origin` | true | 永不导航到不同源 |
| `--avoid-forms` | false | 跳过表单提交（防止数据变更） |
| `--avoid-destructive` | true | 跳过包含 delete/remove/danger 文本的元素 |

### 回溯策略

每次交互后，探索器必须回到交互前的状态以尝试其他候选。按优先顺序使用三种方式：

1. **DOM 快照恢复**：如果交互是导航操作，使用 Playwright 的 `page.goBack()`
2. **重新点击切换**：如果交互切换了弹窗/面板，再次点击同一元素或按 Escape
3. **完全重新导航**：如果以上都不行，重新导航到快照 URL 并等待加载

### 状态去重

当以下两项均匹配时，两个状态被视为"相同"：

1. **URL 相等**：路径和查询参数相同
2. **DOM 哈希相等**：可见文本内容 + 可见元素结构的哈希相同（忽略动态 ID、时间戳、CSRF 令牌）

DOM 哈希的计算方式：
```typescript
function computeDomHash(page: Page): string {
  return page.evaluate(() => {
    const body = document.body.cloneNode(true);
    // 移除 script、style、svg 标签
    body.querySelectorAll('script, style, svg').forEach(el => el.remove());
    // 移除动态属性（data-csrf、data-ts、nonce 等）
    body.querySelectorAll('[data-csrf], [nonce]').forEach(el => {
      el.removeAttribute('data-csrf');
      el.removeAttribute('nonce');
    });
    // 对剩余的文本 + 结构进行哈希
    return hash(body.innerHTML);
  });
}
```

### AI 模型集成

探索器复用视觉审查已有的 `--model-url`、`--model-key`、`--model-name` 配置。额外的选项允许使用更轻量/便宜的模型做探索决策：

```
--explore-model <name>    // 探索决策模型（默认继承 --model-name）
```

探索提示设计为紧凑格式（降低 token 成本）：

```
你正在探索一个网站，目标是发现所有 UI 状态用于 UX 审计。
根据当前页面截图和下方交互元素列表，
排列出最可能揭示新页面状态的前 5 个交互
（弹窗、导航、Tab 面板、表单视图）。

规则：
- 优先选择导航到新页面，而非页内状态变更
- 避免破坏性操作（删除、移除、登出）
- 跳过仅改变样式的元素（主题切换、字号调整）

发现的交互元素：
{candidates}

探索历史：已访问 {pages_visited} 个页面，发现 {states_found} 个状态

请以 JSON 数组格式返回 {selector, reason} 对象，最多 5 项。
```

### 成本估算

以一个典型的 20 页网站、每页 3 个状态为例：

| 阶段 | AI 调用次数 | 每次估算 Token | 总 Token |
|------|-----------|--------------|---------|
| AI 优先级排序 | ~60 | ~1,500（截图 + 文本） | ~90K |
| 完成检测 | ~20 | ~500 | ~10K |
| **合计** | **~80** | | **~100K** |

按 GPT-4o 定价（输入 ~$2.50/1M，输出 ~$10/1M），完整探索约 **$0.35**。使用更小的模型（GPT-4o-mini、Claude Haiku）可降至 **$0.05** 以下。

在纯 DOM 模式下（不使用 `--explore-ai`），AI 成本为零。

## CLI 接口

```
uiux-audit <url> --explore                    # 完整 AI 引导探索
uiux-audit <url> --explore --no-explore-ai    # 仅 DOM 探索（无 AI 成本）
uiux-audit <url> --explore --max-pages 10     # 限制探索范围
uiux-audit <url> --explore --journey auth.yaml # 先登录再探索
uiux-audit <url> --explore --explore-model haiku  # 使用更便宜的模型探索
uiux-audit <url> --explore --explore-output site-map.json  # 保存探索结果
```

### 新增 CLI 选项

| 选项 | 类型 | 默认值 | 描述 |
|------|------|-------|------|
| `--explore` | boolean | false | 启用自主探索 |
| `--no-explore-ai` | boolean | false | 禁用 AI 引导（仅 DOM 模式） |
| `--max-pages` | number | 30 | 最大访问不同 URL 数 |
| `--max-states` | number | 50 | 最大发现页面状态总数 |
| `--max-depth` | number | 5 | 最大导航深度 |
| `--max-interactions` | number | 200 | 最大交互尝试次数 |
| `--explore-timeout` | number | 300 | 探索时间限制（秒） |
| `--explore-model` | string | (model-name) | 探索决策使用的模型 |
| `--explore-output` | string | - | 保存探索地图到文件 |

## 模块结构

```
src/
  explore/
    types.ts           # PageState, Interaction, ExplorationResult, ExplorationConfig
    dom-extractor.ts   # 第一层：基于 DOM 的链接 + 交互提取
    ai-guide.ts        # 第二层：AI 优先级排序和完成检测
    explorer.ts        # 核心探索算法（BFS/优先级队列）
    backtracker.ts     # 交互后状态恢复
    dedup.ts           # DOM 哈希和状态去重
    runner.ts          # 高层编排器、预算执行、统计
    prompts.ts         # 探索决策的 AI 提示模板
```

## 与现有功能的关系

### Journey + 探索器

Journey 先运行以建立认证状态。探索器接收 `storageState` 并用于所有导航。这解决了登录墙和需要认证才能访问的页面。

```typescript
// 在 runner.ts 中
if (config.journey) {
  journeyResult = await runJourney(config);
}
if (config.explore) {
  explorationResult = await runExplorer({
    ...config,
    storageState: journeyResult?.storageState,
  });
}
```

### 探索器 + 视觉审查

探索器产出 `PageState[]`，包含 URL 和交互描述。视觉审查可以使用：
- `pageState.url` → 导航并截图
- `pageState.interactions` → 重放交互以复现状态后再截图
- `pageState.description` → 包含在截图元数据中，供报告上下文使用

### 探索器 + 程序化检查

当前程序化检查（无障碍 + 布局）仅在主 URL 上运行。有了探索器，应扩展到所有发现的页面状态上运行，因为每个状态可能有独特的无障碍/布局问题。

## 待讨论问题

1. **表单处理**：探索器是否应该用测试数据填写表单？发现提交后状态需要这样做，但有修改真实数据的风险。提案：通过 `--explore-fill-forms` 选择加入，并支持配置测试数据。

2. **单页应用**：SPA 在视图切换时可能不改变 URL。DOM 哈希方法可以处理这种情况，但链接提取层无法发现新的"页面"。此时 AI 引导变得至关重要。

3. **认证深度**：Journey 登录后，探索器是否应该通过推断常见路径（`/dashboard`、`/settings`、`/admin`）来发现认证页面？还是仅依赖链接发现？

4. **探索回放**：探索地图是否可以导出为 Journey YAML？这样用户可以对自动发现的旅程进行手动精调。
