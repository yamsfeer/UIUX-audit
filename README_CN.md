# uiux-audit

自动化 UI/UX 质量审计工具。使用 Playwright 加载页面，运行程序化检查（可访问性 + 布局），并可选地使用视觉模型进行视觉审查。

## 工作原理

审计分为两层：

**第一层：程序化检查（无 API 成本）**
- **可访问性** — [axe-core](https://github.com/dequelabs/axe-core) 检查标签、landmark、ARIA、对比度等（约 90 条规则）
- **布局** — 自定义 DOM 检查文本溢出、元素重叠、触摸目标尺寸、视口问题等

**第二层：视觉审查（需要 `--visual`，使用视觉模型 API）**
- **通用审查** — 检测对齐不齐、间距不一致、视觉层次问题、布局混乱等
- **设计符合性审查** — 将截图与 UI/UX 设计文档（Markdown）对比，找出偏离

## 安装

```bash
# 全局安装（推荐）
npm install -g uiux-audit
npx playwright install chromium

# 或者不安装，直接通过 npx 运行
npx uiux-audit --help
```

## 配置

uiux-audit 使用分层配置系统，高优先级覆盖低优先级：

| 优先级 | 来源 | 适用场景 |
|---|---|---|
| 1（最高） | CLI 参数（`--model-url`、`--model-name`） | 一次性覆盖 |
| 2 | 环境变量（`UIUX_AUDIT_*`） | 生产环境 / CI / NPM 全局安装 |
| 3 | 工作目录下的 `.env` 文件 | 本地开发 |
| 4（最低） | 内置默认值（火山引擎 Ark + Doubao-Seed-2.0-pro） | 零配置开箱即用 |

### API 密钥

**API 密钥必须通过环境变量传入——永远不要放在命令行上。** 命令行参数在 `ps aux` 和 shell 历史记录中可见。

```bash
# 本地开发：在项目中创建 .env 文件
echo 'UIUX_AUDIT_MODEL_KEY=你的密钥' > .env

# 生产 / CI：导出环境变量
export UIUX_AUDIT_MODEL_KEY=你的密钥

# 一次性使用：内联环境变量
UIUX_AUDIT_MODEL_KEY=你的密钥 uiux-audit http://localhost:5173 --visual
```

### 默认模型

默认使用火山引擎 Ark 的**豆包（Doubao-Seed-2.0-pro）**模型。如需使用其他模型：

```bash
# 通过 CLI 参数
uiux-audit http://localhost:5173 --visual --model-url https://api.openai.com --model-name gpt-4o

# 通过环境变量
export UIUX_AUDIT_MODEL_URL=https://api.openai.com
export UIUX_AUDIT_MODEL_NAME=gpt-4o
```

## 快速开始

```bash
# 对本地网站运行可访问性 + 布局检查（无需配置）
uiux-audit http://localhost:5173

# 或者通过 npx（无需安装）
npx uiux-audit http://localhost:5173

# 将报告保存为 JSON
uiux-audit http://localhost:5173 --output json --output-file report.json

# 保存报告和截图到目录
uiux-audit http://localhost:5173 --output json --output-dir ./audit-results

# 启用视觉审查（通过环境变量或 .env 设置 API 密钥）
UIUX_AUDIT_MODEL_KEY=你的密钥 uiux-audit http://localhost:5173 --visual
```

## 使用方法

```
uiux-audit <url> [选项]
```

### 选项

| 选项 | 说明 | 默认值 |
|---|---|---|
| `--visual` | 启用视觉审查层 | 关闭 |
| `--design-spec <路径>` | UI/UX 设计文档（Markdown），用于设计符合性审查 | — |
| `--model-url <url>` | 视觉模型 API 地址 | `https://ark.cn-beijing.volces.com/api/coding/v3` |
| `--model-name <名称>` | 视觉模型名称 | `Doubao-Seed-2.0-pro` |
| `--viewport <尺寸>` | 视口尺寸，格式 `WxH`，逗号分隔 | `1440x900` |
| `--output <格式>` | 输出格式：`json`、`markdown`、`table` | `table` |
| `--output-file <路径>` | 输出到文件而非终端 | — |
| `--output-dir <目录>` | 报告和截图的输出目录；默认创建时间戳子目录 | — |
| `--no-timestamp` | 使用 `--output-dir` 时直接写入目录，不创建时间戳子目录 | — |
| `--no-a11y` | 跳过可访问性检查 | — |
| `--no-layout` | 跳过布局检查 | — |
| `--pages <url列表>` | 额外的页面 URL，逗号分隔 | — |
| `--journey <路径>` | 审计前执行的旅程文件（YAML 或 JS），用于登录/初始化 | — |

### 环境变量

| 变量 | 是否必需 | 说明 |
|---|---|---|
| `UIUX_AUDIT_MODEL_KEY` | 是（`--visual` 时） | 视觉模型 API 密钥。**切勿**通过 CLI 传入。 |
| `UIUX_AUDIT_MODEL_URL` | 否 | 视觉模型 API 地址（默认 `https://ark.cn-beijing.volces.com/api/coding/v3`） |
| `UIUX_AUDIT_MODEL_NAME` | 否 | 视觉模型名称（默认 `Doubao-Seed-2.0-pro`） |

### 示例

**基础审计（无 API 成本）：**
```bash
uiux-audit http://localhost:5173
```

**保存报告和截图到目录：**
```bash
# 创建 ./audit-results/2026-04-28T15-30-00/report.json 和 screenshots/
uiux-audit http://localhost:5173 --output json --output-dir ./audit-results

# 直接写入 ./audit-results/（不创建时间戳子目录）
uiux-audit http://localhost:5173 --output json --output-dir ./audit-results --no-timestamp
```

**多视口（桌面 + 手机）：**
```bash
uiux-audit http://localhost:5173 --viewport 1440x900,375x812
```

**完整审计含视觉审查：**
```bash
# 先设置环境变量，再运行
UIUX_AUDIT_MODEL_KEY=你的密钥 uiux-audit http://localhost:5173 --visual \
  --output json --output-file /tmp/ux-report.json
```

**设计符合性检查：**
```bash
UIUX_AUDIT_MODEL_KEY=你的密钥 uiux-audit http://localhost:5173 --visual \
  --design-spec ./docs/UIUX.md
```

**使用其他模型供应商：**
```bash
UIUX_AUDIT_MODEL_KEY=sk-xxx uiux-audit http://localhost:5173 --visual \
  --model-url https://api.openai.com \
  --model-name gpt-4o
```

**审计多个页面：**
```bash
uiux-audit http://localhost:5173 --pages /about,/contact,/settings
```

**审计需要登录的页面（旅程）：**
```bash
uiux-audit http://localhost:5173 --journey ./login-journey.yaml
```

详见下方 [旅程](#旅程) 章节。

## 检测内容

### 可访问性（axe-core）

标签、landmark、ARIA 属性、颜色对比度、标题层级、图片 alt、焦点管理等（axe-core 约 90 条规则）。

### 布局（程序化检查）

| 问题 | 严重程度 | 检测方式 |
|---|---|---|
| 文本水平溢出 | critical | `scrollWidth > clientWidth` 且 `overflow: hidden/clip` |
| 文本垂直溢出（被裁剪） | critical | `scrollHeight > clientHeight` 且 `overflow-y: hidden/clip` |
| 元素重叠 | warning | `getBoundingClientRect()` 相交且非父子关系 |
| 触摸目标过小 | warning | 可交互元素宽或高 < 44px |
| 元素超出视口 | critical | 元素边界超出窗口尺寸 |
| 图片缺少尺寸 | info | `<img>` 没有明确的 width/height |
| 零尺寸元素含文本 | critical | `clientWidth=0 && clientHeight=0` 但有文本内容 |

### 视觉（视觉模型）

对齐不齐、间距不一致、视觉层次问题、颜色问题、内容被截断、布局混乱、样式不一致、设计文档偏离等。

## 输出格式

报告中每个问题包含：

| 字段 | 说明 |
|---|---|
| `type` | 问题类别（如 `label`、`overflow-x`、`visual-issue`） |
| `severity` | `critical`、`warning` 或 `info` |
| `selector` | CSS 选择器，定位问题元素 |
| `description` | 问题描述 |
| `evidence` | 可量化的证据（尺寸、规则违规等） |
| `fixSuggestion` | 修复建议 |
| `deviation` | （仅设计符合性审查）违反了哪条设计规范 |

## AI Agent 集成

uiux-audit 专为与 AI 编程 Agent 协作循环而设计：

1. Agent 启动开发服务器
2. Agent 运行：`uiux-audit http://localhost:PORT --output json --output-dir /tmp/audit-results`
3. Agent 从 `/tmp/audit-results/<时间戳>/report.json` 读取 JSON 报告，根据 `selector` 和 `fixSuggestion` 修复问题
4. Agent 重新运行审计
5. 循环直到 `critical` 和 `warning` 数量为零

JSON 输出为机器解析而设计——Agent 可以遍历 `results[].issues[]`，用 `selector` 定位源码，用 `fixSuggestion` 应用修复。

## 旅程

旅程文件用于在审计前自动化登录和初始化步骤。适用于需要认证或特定状态的页面。

### YAML 旅程

创建包含步骤的 YAML 文件：

```yaml
name: Standard login
steps:
  - goto: ${BASE_URL}/login
  - fill:
      selector: input[type="text"]
      value: ${LOGIN_EMAIL}
  - fill:
      selector: input[type="password"]
      value: ${LOGIN_PASSWORD}
  - click: button[type="submit"]
  - waitFor: body
  - wait: 1000
```

运行：
```bash
uiux-audit http://localhost:5173 --journey ./login-journey.yaml
```

### 支持的步骤

| 步骤 | 说明 |
|---|---|
| `goto: <url>` | 导航到 URL（`${BASE_URL}` 解析为审计目标地址） |
| `fill: { selector, value }` | 填充输入框 |
| `click: <selector>` | 点击元素 |
| `press: <key>` | 按下键盘按键（如 `Enter`、`Escape`） |
| `select: { selector, value }` | 选择 `<select>` 中的选项 |
| `check: <selector>` | 勾选复选框 |
| `uncheck: <selector>` | 取消勾选复选框 |
| `wait: <毫秒>` | 等待指定毫秒数 |
| `waitFor: <selector>` 或 `{ selector, timeout? }` | 等待元素出现 |
| `waitForNavigation: <url>` | 等待导航到指定 URL |
| `assert: { selector?, url?, title? }` | 断言元素存在、当前 URL 或页面标题 |
| `screenshot: <文件名>` | 截图（保存到输出目录） |

`${LOGIN_EMAIL}` 等环境变量会从进程环境中替换。

### JS 旅程

对于更复杂的流程，使用 JavaScript 文件：

```js
export default async function ({ page, resolveUrl, baseUrl }) {
  await page.goto(resolveUrl('/login'));
  await page.fill('input[type="text"]', process.env.LOGIN_EMAIL);
  await page.fill('input[type="password"]', process.env.LOGIN_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard');

  // 返回登录后要审计的路径
  return ['/dashboard', '/settings'];
}
```

会话状态（cookies、localStorage）在旅程和审计之间保持一致。

## CJK 字体支持

Playwright 自带的 Chromium 在没有安装 CJK（中日韩）字体的系统上会将字符渲染为空白方框。修复方法：

**Debian/Ubuntu：**
```bash
sudo apt install fonts-noto-cjk
```

**RHEL/CentOS/OpenCloudOS：**
```bash
sudo dnf install google-noto-sans-cjk-sc-fonts google-noto-sans-mono-cjk-sc-fonts
```

本工具在所有浏览器上下文中设置了 `locale: 'zh-CN'`，以确保 Chromium 正确选择 CJK 字体。

## 视觉模型 API

使用 OpenAI 兼容的 `/v1/chat/completions` 接口。支持任何提供此 API 的服务：

- **默认**：火山引擎 Ark (Doubao-Seed-2.0-pro) — 仅需 API 密钥即可使用
- OpenAI (gpt-4o、gpt-4o-mini)
- Azure OpenAI
- 其他任何 OpenAI 兼容的供应商

如需使用不同供应商，设置 `UIUX_AUDIT_MODEL_URL` 和 `UIUX_AUDIT_MODEL_NAME` 即可。

## 许可证

MIT
