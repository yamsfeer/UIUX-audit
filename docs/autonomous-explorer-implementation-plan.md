# 自主探索器：实现计划

## 概述

本计划将自主探索器功能分解为 6 个阶段，按依赖关系排序。每个阶段产出一个可用的增量——工具在每个阶段都能工作，只是能力逐步增强。

**预估总工作量**：约 2,500 行新代码，涉及 8 个新文件 + 4 个现有文件的修改。

---

## 第一阶段：基础——类型定义与 DOM 提取器

**目标**：建立数据模型和零 AI 成本的发现层。

### 新增文件

#### `src/explore/types.ts`

定义所有核心类型：

- `PageState` — url、stateId、description、interactions、domHash、screenshot
- `Interaction` — type、selector、value、label、priority
- `InteractionCandidate` — 扩展 Interaction，增加元素元数据（tagName、textContent、href、role、ariaHasPopup 等）
- `ExplorationConfig` — 所有预算控制（maxPages、maxStates、maxDepth、maxInteractions、timeoutMs、stayOnOrigin、avoidDestructive、avoidForms、aiGuided、exploreModel）
- `ExplorationResult` — pageStates、siteMap、stats
- `ExplorationStats` — pagesDiscovered、statesDiscovered、interactionsAttempted、aiDecisionsMade、durationMs
- `ExplorationContext` — Playwright page、已访问集合、队列、配置、统计（算法中传递的可变状态）

默认配置值：
```typescript
const DEFAULT_EXPLORATION_CONFIG: ExplorationConfig = {
  maxPages: 30,
  maxStates: 50,
  maxDepth: 5,
  maxInteractions: 200,
  timeoutMs: 300_000,
  stayOnOrigin: true,
  avoidDestructive: true,
  avoidForms: false,
  aiGuided: true,
  exploreModel: undefined, // 继承 model-name
};
```

#### `src/explore/dom-extractor.ts`

第一层——纯 DOM 分析，无 AI 调用。函数：

1. **`extractLinks(page: Page, baseUrl: string): LinkCandidate[]`**
   - 查询所有 `<a href>` 元素
   - 基于 baseUrl 解析相对 URL
   - 过滤：仅同源（如 stayOnOrigin 启用）、跳过 `javascript:void(0)`、跳过仅 `#` 锚点、跳过 `mailto:`、`tel:`
   - 返回：`{ url, selector, text, depth }` — depth 由 URL 路径段数推断

2. **`extractInteractions(page: Page): InteractionCandidate[]`**
   - 查询策略：
     - 按钮：`button, [role="button"], input[type="submit"], input[type="button"]`
     - 弹窗/下拉触发器：`[aria-haspopup], [data-modal], [data-dropdown], [data-overlay]`
     - Tab/手风琴：`[role="tab"], details > summary, [aria-expanded]`
     - 表单控件：`input:not([type="hidden"]), select, textarea`
     - 可点击元素：`[onclick], [tabindex]:not([tabindex="-1"])`
   - 对每个候选：
     - 检查可见性（`page.isVisible()`）
     - 提取文本内容（截断至 100 字符）
     - 读取 `aria-label`、`title`、`placeholder` 属性
     - 分类交互类型：`navigate`、`toggle-state`、`submit-form`、`fill-input`
   - 如启用 `avoidDestructive`，过滤掉破坏性候选：文本匹配 `/delete|remove|destroy|logout|sign.?out/i`
   - 如启用 `avoidForms`，过滤掉表单提交

3. **`extractPageMetadata(page: Page): PageMetadata`**
   - 页面标题、meta 描述、H1 文本
   - 可见文本长度（区分内容页与空白/加载状态）
   - 交互元素计数
   - 返回紧凑摘要，供 AI 提示上下文使用

4. **`isSameOrigin(url1: string, url2: string): boolean`**
   - 比较 protocol + hostname + port

### 现有文件变更

本阶段无。

### 测试

- 单元测试：使用 Playwright 加载静态 HTML 页面测试 `extractLinks`
- 单元测试：测试包含各种元素类型的页面的 `extractInteractions`
- 单元测试：破坏性元素过滤
- 单元测试：同源检查

---

## 第二阶段：状态去重与回溯

**目标**：使探索器能够访问页面、检测新状态与已知状态、以及在交互后返回干净状态。

### 新增文件

#### `src/explore/dedup.ts`

1. **`computeDomHash(page: Page): Promise<string>`**
   - 注入 JS 执行：
     - 克隆 `document.body`
     - 移除 `<script>`、`<style>`、`<svg>`、`<noscript>`、`<link>` 元素
     - 移除动态属性：`data-csrf`、`nonce`、`data-token`，以及名称中包含 `timestamp` 或 `ts` 的属性
     - 移除 `style` 属性（内联样式会动态变化但不代表新状态）
     - 获取克隆体的 `innerText`，规范化空白
     - 返回结果的 SHA-256 哈希
   - 哈希基于文本内容 + 结构标签，而非完整 HTML——对微小动态变化具有鲁棒性

2. **`computeStateId(url: string, domHash: string): string`**
   - 将 URL 路径 + 查询参数（忽略 hash）与 domHash 组合
   - 返回 `${urlPath}::${domHash.slice(0,12)}`
   - 意味着：同 URL 不同 DOM = 不同状态（SPA），不同 URL 同 DOM = 不同状态（重定向到相同视图）

3. **`StateRegistry` 类**
   - 维护已访问 stateId 的 `Set<string>`
   - `has(stateId): boolean`
   - `add(stateId): void`
   - `size(): number`
   - 供探索算法检查去重

#### `src/explore/backtracker.ts`

1. **`createSnapshot(page: Page): Promise<PageSnapshot>`**
   - 保存：当前 URL、滚动位置、视口状态
   - 不保存完整 DOM 快照（太昂贵）——依赖重新导航

2. **`restoreFromSnapshot(page: Page, snapshot: PageSnapshot): Promise<void>`**
   - 策略选择：
     - 如果 URL 变化 → `page.goBack()` + 验证 URL 是否匹配
     - 如果 URL 不变但 DOM 变化 → 尝试按 Escape 键，然后重新导航
     - 如果都不行 → 重新导航到快照 URL 并等待加载
   - 恢复后，可通过快速哈希检查验证状态（可选，可跳过以提升性能）
   - 如恢复失败，抛出 `BacktrackError`——调用方应中止此分支的探索

3. **`class InteractionGuard`**
   - 用自动回溯包裹交互尝试：
   ```typescript
   async withBacktrack<T>(page: Page, fn: () => Promise<T>): Promise<T | null> {
     const snapshot = await createSnapshot(page);
     try {
       const result = await fn();
       await restoreFromSnapshot(page, snapshot);
       return result;
     } catch {
       try { await restoreFromSnapshot(page, snapshot); } catch {}
       return null;
     }
   }
   ```

### 测试

- 单元测试：`computeDomHash` 对有微小动态差异的页面返回相同哈希
- 单元测试：`computeDomHash` 对结构不同的页面返回不同哈希
- 单元测试：`computeStateId` 唯一性
- 集成测试：与页面交互（打开弹窗），然后回溯，验证页面状态已恢复

---

## 第三阶段：核心探索算法（仅 DOM 模式）

**目标**：一个可工作的探索器，仅使用 DOM 提取发现页面和状态——无需 AI。

### 新增文件

#### `src/explore/explorer.ts`

主探索循环：

1. **`class Explorer`**
   - 构造函数：`(config: ExplorationConfig, browser: Browser, storageState?: string)`
   - 创建带可选 storageState 的浏览器上下文

2. **`async explore(startUrl: string): Promise<ExplorationResult>`**
   - 主算法：
   ```
   初始化：
     queue = new PriorityQueue<ExplorationTarget>()
     registry = new StateRegistry()
     results: PageState[] = []
     stats = new ExplorationStats()
     startTime = Date.now()

   播种：
     queue.enqueue({ type: 'navigate', url: startUrl, depth: 0 }, priority: 1.0)

   循环（队列非空且预算充足）：
     检查预算：stats vs config 限制，已用时间 vs timeoutMs

     target = queue.dequeue()
     page = context.newPage()

     导航：
       page.goto(target.url, { waitUntil: 'networkidle' })
       await page.waitForTimeout(500)  // 等待稳定

     捕获状态：
       domHash = computeDomHash(page)
       stateId = computeStateId(page.url(), domHash)
       if registry.has(stateId): continue
       registry.add(stateId)

       pageState = capturePageState(page, stateId, domHash, target)
       results.push(pageState)

     发现链接：
       links = extractLinks(page, startUrl)
       for link of links:
         if not registry.has(link.stateId) and link.depth <= maxDepth:
           queue.enqueue(link, priority: 0.7)

     发现交互：
       candidates = extractInteractions(page)
       for candidate of candidates（按优先级/启发式排序）：
         if stats.interactionsAttempted >= maxInteractions: break

         await interactionGuard.withBacktrack(page, async () => {
           stats.interactionsAttempted++
           await executeInteraction(page, candidate)
           await page.waitForTimeout(300) // 等待稳定

           newDomHash = computeDomHash(page)
           newStateId = computeStateId(page.url(), newDomHash)
           if not registry.has(newStateId):
             queue.enqueue({
               type: 'interact',
               url: page.url(),
               interaction: candidate,
               depth: target.depth
             }, priority: candidate.priority or 0.5)
         })

     page.close()

   返回：
     { pageStates: results, siteMap: buildSiteMap(results), stats }
   ```

3. **`executeInteraction(page: Page, interaction: InteractionCandidate): Promise<void>`**
   - 按类型分发：
     - `navigate` → `page.goto(interaction.href)`
     - `click` → `page.click(interaction.selector)`
     - `toggle-state` → `page.click(interaction.selector)`
     - `fill-input` → 跳过（DOM 模式无测试数据）
     - `submit-form` → 如 avoidForms 则跳过

4. **`capturePageState(page, stateId, domHash, target): PageState`**
   - 捕获：URL、标题、描述（来自页面元数据）、domHash、从 target 继承的交互链
   - 可选：为探索地图拍摄轻量截图

5. **优先级启发式（仅 DOM，无 AI）**：
   - 来自 `<nav>` 或 `[role="navigation"]` 的链接：优先级 0.9
   - 文本暗示内容页的链接：优先级 0.8
   - `[aria-haspopup]` 触发器：优先级 0.7
   - 通用按钮：优先级 0.5
   - 表单控件：优先级 0.3

#### `src/explore/runner.ts`

高层编排器：

1. **`runExplorer(config: AuditConfig & { storageState?: StorageState }): Promise<ExplorationResult>`**
   - 验证：如 `aiGuided` 为 true，检查模型配置是否存在
   - 启动浏览器（或复用审计运行器的）
   - 创建 Explorer 实例
   - 调用 `explorer.explore(config.url)`
   - 优雅处理错误（超时/预算耗尽时返回部分结果）
   - 将统计信息输出到控制台
   - 返回 ExplorationResult

### 现有文件变更

#### `src/checks/types.ts`

将 `ExplorationConfig` 字段添加到 `AuditConfig`：
```typescript
export interface AuditConfig {
  // ... 现有字段 ...
  explore?: boolean;
  exploreConfig?: ExplorationConfig;
}
```

#### `src/config.ts`

将新 CLI 选项解析到配置：
- `--explore` → `config.explore = true`
- `--no-explore-ai` → `config.exploreConfig.aiGuided = false`
- `--max-pages` → `config.exploreConfig.maxPages`
- `--max-states` → `config.exploreConfig.maxStates`
- `--max-depth` → `config.exploreConfig.maxDepth`
- `--max-interactions` → `config.exploreConfig.maxInteractions`
- `--explore-timeout` → `config.exploreConfig.timeoutMs`
- `--explore-model` → `config.exploreConfig.exploreModel`
- `--explore-output` → `config.exploreOutput`
- `--avoid-forms` → `config.exploreConfig.avoidForms = true`

#### `src/index.ts`

在 commander 程序中添加新 CLI 选项。

#### `src/runner.ts`

将探索器集成到审计管线：
```typescript
// 在 journey 之后、检查之前
let explorationResult: ExplorationResult | undefined;
if (config.explore) {
  explorationResult = await runExplorer({
    ...config,
    storageState: journeyResult?.storageState,
  });

  // 将发现的页面合并到审计范围
  const discoveredUrls = explorationResult.pageStates.map(ps => ps.url);
  config.pages = [...new Set([...config.pages, ...discoveredUrls])];

  // 如有请求，保存探索地图
  if (config.exploreOutput) {
    await fs.writeFile(config.exploreOutput, JSON.stringify(explorationResult, null, 2));
  }
}
```

### 测试

- 集成测试：探索一个含 3 个链接 HTML 页面的本地静态站点——验证全部 3 个被发现
- 集成测试：探索含弹窗的页面——验证弹窗状态被捕获为独立 PageState
- 集成测试：预算限制生效（在 5 页网站上设置 max-pages: 2）
- 集成测试：超时生效
- 集成测试：同源过滤阻止外部链接

---

## 第四阶段：AI 引导层

**目标**：在 DOM 探索器之上添加 AI 驱动的优先级排序和决策能力。

### 新增文件

#### `src/explore/prompts.ts`

探索 AI 的提示模板：

1. **`buildPrioritizationPrompt(candidates, metadata, history, budget): { system: string, user: string }`**
   - 系统：你是一个用于 UX 审计的网站探索代理。按揭示新 UI 状态的可能性排列交互。
   - 用户：截图 + 候选列表 + 探索历史 + 剩余预算
   - 响应格式：`{ selector, reason, priority }` 的 JSON 数组

2. **`buildCompletionPrompt(metadata, history): { system: string, user: string }`**
   - 问题："根据当前页面和已有发现，是否还可能有更多内容？"
   - 响应：`{ complete: boolean, reasoning: string }`

3. **`buildFormStrategyPrompt(form, metadata): { system: string, user: string }`**
   - 问题："为了发现新状态，此表单应该填写什么测试值？"
   - 响应：`{ fields: [{ selector, value, reason }] }`

#### `src/explore/ai-guide.ts`

1. **`class AIGuide`**
   - 构造函数：`(config: ModelConfig)` — modelUrl、modelKey、modelName
   - 使用与视觉审查相同的 OpenAI 兼容 API

2. **`async prioritize(page: Page, candidates: InteractionCandidate[], history: ExplorationStats, budget: Budget): Promise<RankedInteraction[]>`**
   - 拍摄当前页面的视口截图
   - 用候选列表构建优先级排序提示
   - 用截图 + 提示调用模型
   - 解析响应：含选择器和原因的排序列表
   - 映射回原始候选（验证选择器在页面上仍存在）
   - 返回前 N 个（默认 5）排序的交互
   - API 失败时：回退到 DOM 启发式优先级

3. **`async isPageExplored(page: Page, history: ExplorationStats): Promise<boolean>`**
   - 用当前状态调用完成检测提示
   - 解析布尔响应
   - API 失败时：返回 false（假设还有更多可发现）

4. **`async suggestFormFill(page: Page, formSelector: string): Promise<FormFillPlan>`**
   - 仅在 `avoidForms` 为 false 时调用
   - 返回表单字段的测试值
   - 使用常见模式：email → `test@example.com`，name → `Test User` 等

### 对 `src/explore/explorer.ts` 的变更

在主循环中，当 `config.aiGuided` 为 true 时，用 AI 引导的优先级排序替换 DOM 启发式：

```typescript
// 之前：按启发式优先级排序候选
// 之后：
if (config.aiGuided && candidates.length > 0) {
  const ranked = await aiGuide.prioritize(page, candidates, stats, remainingBudget);
  candidates = ranked.slice(0, 5); // 每页只尝试前 5 个
} else {
  candidates.sort((a, b) => b.priority - a.priority);
  candidates = candidates.slice(0, 10); // 仅 DOM：尝试更多
}
```

同时添加完成检测：
```typescript
if (config.aiGuided) {
  const explored = await aiGuide.isPageExplored(page, stats);
  if (explored) {
    // 跳过此页面的进一步交互发现
    continue;
  }
}
```

### 测试

- 单元测试：提示构建器产出有效提示
- 单元测试：AI 响应解析
- 单元测试：API 失败时回退到 DOM 启发式
- 集成测试：AI 引导探索在 SPA 上发现比纯 DOM 更多的状态
- 成本追踪：验证 AI 调用次数记录在统计中

---

## 第五阶段：探索器-审计集成

**目标**：使探索器结果完整接入审计管线，包括在所有发现的状态上运行程序化检查。

### 对 `src/runner.ts` 的变更

当前，程序化检查（无障碍 + 布局）仅在主 URL 上运行。有了探索器，扩展到在所有发现的页面状态上运行：

```typescript
if (explorationResult) {
  const allCheckResults: CheckResult[] = [];

  for (const pageState of explorationResult.pageStates) {
    const context = await createContext(storageState);
    const page = await context.newPage();
    await page.goto(pageState.url, { waitUntil: 'networkidle' });

    // 重放交互以到达特定状态
    for (const interaction of pageState.interactions) {
      await replayInteraction(page, interaction);
    }

    // 在此状态上运行检查
    if (!config.noA11y) {
      allCheckResults.push(await runAccessibilityCheck(page));
    }
    if (!config.noLayout) {
      allCheckResults.push(await runLayoutCheck(page));
    }

    await context.close();
  }

  // 合并结果
  allResults.push(...allCheckResults);
}
```

### 对 `src/visual/screenshot.ts` 的变更

支持重放交互以捕获特定状态的截图：

```typescript
interface ScreenshotTarget {
  url: string;
  label: string;            // "首页"、"设置弹窗已打开"
  interactions?: Interaction[]; // 截图前重放
}
```

在 `captureScreenshots` 中，导航到每个 URL 后，在拍摄视口/整页/覆盖层截图前重放交互。

### 对 `src/report/formatter.ts` 的变更

在报告中包含探索元数据：
- 发现的页面/状态数量
- 站点地图树
- 每状态的问题归属（哪些问题在哪个状态上发现）

### 测试

- 集成测试：完整管线——探索 → 审计 → 报告，验证问题归属到正确的页面状态
- 集成测试：探索器 + Journey 组合（先登录再探索）
- 验证报告包含探索统计

---

## 第六阶段：探索地图导出与 Journey 生成

**目标**：允许用户保存、检查和精调探索结果——并将它们转换为可编辑的 Journey 文件。

### 新增文件

#### `src/explore/site-map.ts`

1. **`buildSiteMap(pageStates: PageState[]): SiteMapNode`**
   - 从扁平的 PageState 列表按 URL 路径层级构建树
   - 根节点 = startUrl
   - 子节点 = 发现的页面，按路径段分组
   - 每个节点包含状态（例如，"弹窗打开"作为页面的子状态）

2. **`formatSiteMap(node: SiteMapNode, indent?: number): string`**
   - 美化输出为 ASCII 树用于控制台展示：
   ```
   / (首页)
   ├── /products
   │   ├── [弹窗: "加入购物车对话框"]
   │   └── /products/detail
   ├── /about
   └── /contact
       └── [表单: "联系表单已提交"]
   ```

3. **`exportSiteMapJson(result: ExplorationResult): object`**
   - 用于 `--explore-output` 的完整结构化 JSON

4. **`generateJourneyYaml(result: ExplorationResult): string`**
   - 将探索结果转换为有效的 Journey YAML 文件
   - 对每个含交互的 PageState，输出步骤序列：
   ```yaml
   name: 自动探索旅程
   steps:
     - goto: /
     - click: button.open-menu
     - waitFor: .menu-panel
     - screenshot: menu-open
     - click: button.close-menu
     - goto: /products
     - click: button.add-to-cart
     - waitFor: .cart-dialog
     - screenshot: cart-dialog
   ```
   - 这让用户可以拿一条自动发现的路径，编辑后作为手动 Journey 使用

### 对 `src/runner.ts` 的变更

- 探索完成后，将站点地图输出到控制台
- 如指定 `--explore-output`，将 JSON 站点地图写入文件
- 如指定 `--explore-journey`，将生成的 Journey YAML 写入文件

### 新增 CLI 选项

| 选项 | 描述 |
|------|------|
| `--explore-output <path>` | 将探索地图保存为 JSON |
| `--explore-journey <path>` | 将探索结果导出为 Journey YAML 文件 |

### 测试

- 单元测试：使用各种 URL 结构测试 `buildSiteMap`
- 单元测试：`generateJourneyYaml` 产出可被 journey 解析器解析的有效 YAML
- 集成测试：探索 → 导出 → 用导出的 Journey 重新运行 → 覆盖相同

---

## 实现顺序总结

| 阶段 | 文件 | 依赖 | 交付物 |
|------|------|------|--------|
| 1 | types.ts, dom-extractor.ts | 无 | 数据模型 + DOM 发现 |
| 2 | dedup.ts, backtracker.ts | 第一阶段 | 状态追踪 + 回溯 |
| 3 | explorer.ts, runner.ts + 修改 types.ts, config.ts, index.ts, runner.ts | 第一、二阶段 | 可用的仅 DOM 探索器 |
| 4 | prompts.ts, ai-guide.ts + 修改 explorer.ts | 第三阶段 | AI 引导探索 |
| 5 | 修改 runner.ts, screenshot.ts, formatter.ts | 第三、四阶段 | 完整审计管线集成 |
| 6 | site-map.ts + 修改 runner.ts | 第三阶段 | 导出 + Journey 生成 |

每个阶段独立可测试、可交付。仅第三阶段就给用户一个零 AI 成本的网站探索器。第四阶段叠加智能。第五阶段深化审计覆盖。第六阶段将自动探索结果转回手动可编辑的 Journey，形成闭环。
