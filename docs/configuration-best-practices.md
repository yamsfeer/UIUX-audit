# CLI 工具配置管理：CLI 参数、环境变量、配置文件与敏感数据的业界实践

## 1. 配置的四个来源

一个 CLI 工具的配置通常来自四个层级，按优先级从高到低：

| 优先级 | 来源 | 示例 | 适用内容 |
|--------|------|------|----------|
| 1（最高） | CLI 参数 | `--model-name gpt-4o` | 本次执行临时覆盖 |
| 2 | 环境变量 | `UIUX_MODEL_NAME=gpt-4o` | 敏感数据、会话级配置 |
| 3 | 配置文件 | `.uiux-audit.json` 或 `~/.config/uiux-audit/config.json` | 项目级或全局的非敏感配置 |
| 4（最低） | 硬编码默认值 | 代码里的 `'gpt-4o'` | 开箱即用的默认行为 |

### 优先级为什么是这个顺序

这条链的核心理念来自 [12-Factor App](https://12factor.net/config)：

> **CLI 参数 > 环境变量 > 配置文件 > 默认值**

- **CLI 参数最高**：因为它是用户**本次执行**明确表达的意图。用户敲了 `--model-name foo`，那一定想用 `foo`，不管 env 或配置文件说了什么。
- **环境变量次之**：因为它是运行环境的属性，跟操作系统绑定，可以跨进程继承，且不容易被误提交到 git。适合存 secret。
- **配置文件再次**：因为它接近代码仓库，容易分享和版本管理，但安全性不如 env。适合存非敏感的行为性配置。
- **默认值最低**：保证工具在没有配置的情况下也能跑起来。

### 实现伪代码

```typescript
function resolveConfig(cliArgs, env, configFile, defaults) {
  return {
    modelName: cliArgs.modelName
      ?? env.UIUX_MODEL_NAME
      ?? configFile.modelName
      ?? defaults.modelName,
    // ...
  };
}
```

## 2. CLI 参数 vs 环境变量：本质区别

很多新手以为 CLI flag 和 env 差不多——"反正最后都存到一个变量里"。但它们的**使用场景**完全不同：

| 维度 | CLI 参数 | 环境变量 |
|------|----------|----------|
| 生命周期 | 单次执行 | 当前 shell session 或持久化在 `.env` / shell profile |
| 可见性 | 在 `ps aux` 中可见 | 在 `ps aux` 中不可见（但 `/proc/<pid>/environ` 可读） |
| 使用成本 | 每次都要敲 | 设一次，持续生效 |
| 适合存什么 | 本次想临时改的东西 | 长期不变的配置、secret |
| 不适合存什么 | 长期固定的 key | CI 中想显式传递的值（CI log 不会泄露 env） |
| 代表场景 | `--verbose`、`--output html` | `API_KEY`、`DATABASE_URL` |

### 经验法则

- **行为类配置**（verbose、output 格式、是否启用某功能）：CLI flag 为主，配置文件为辅。
- **连接类配置**（API URL、model name、timeout）：环境变量为主，配置文件为辅。
- **密钥**（API key、token）：**只能**用环境变量。永远不要出现在 CLI flag 或配置文件中。

## 3. `.env` 文件的定位

`.env` 文件是**环境变量的批量设置器**，不是独立的一级配置。从你的 `env.ts` 实现就能看出来：

```typescript
// .env 做的事情就是：把文件内容读到 process.env 里
if (!process.env[match[1]]) {
  process.env[match[1]] = match[2].trim();
}
```

关键细节：**已有环境变量优先**（`!process.env[match[1]]`）。这意味着：

```
Shell 环境变量  >  .env 文件
```

这个设计是正确的。原因：

- **安全边界**：CI/CD 平台（GitHub Actions、Vercel）通过 secrets 注入环境变量，它们不应该被 repo 里的 `.env` 文件覆盖。如果 `.env` 能覆盖 CI secrets，就是安全隐患。
- **意图表达**：用户在 shell 里显式 `export` 的变量，优先级应该比一个自动加载的文件高。

### `.env` 应该进 `.gitignore`

```
# .gitignore
.env
.env.local
.env.*.local
```

`.env` 含有 secret，**永远不要提交到 git**。但可以提交一个 `.env.example` 作为模板，里面只列出 key 名，value 为空或占位：

```
# .env.example （可以提交）
UIUX_AUDIT_MODEL_URL=
UIUX_AUDIT_MODEL_KEY=
UIUX_AUDIT_MODEL_NAME=gpt-4o
```

## 4. 配置文件：何时需要

### 什么时候不需要配置文件

如果你的工具只有一个供应商、两三个配置项、用户大概率直接敲命令就跑，那 **CLI flag + env + .env 就够了**。过度设计配置文件反而是负担。

`npx tinybench --duration 30` — 不需要配置文件。

### 什么时候需要配置文件

- 配置项超过 5-6 个
- 有嵌套结构（比如 viewports 是个数组）
- 用户希望**项目级固化**某些行为，团队共享
- 需要切换多个 profile / provider

### 配置文件放哪里

| 位置 | 作用域 | 格式 | 代表工具 |
|------|--------|------|----------|
| 项目根目录 `.toolrc` | 当前项目 | JSON / YAML / JS | `.eslintrc.json`、`.prettierrc`、`playwright.config.ts` |
| 项目 `package.json` 的 `"tool"` 字段 | 当前项目 | JSON | `ava`、`np` |
| `~/.config/tool/config.json` | 当前用户全局 | JSON / YAML | `gcloud`、`gh` |
| `~/.toolrc` | 当前用户全局 | JSON / YAML | `.npmrc` |

### 优先级

```
项目配置文件  >  全局配置文件  >  默认值
```

并且全部低于环境变量和 CLI 参数：

```
CLI 参数  >  环境变量  >  项目配置文件  >  全局配置文件  >  默认值
```

## 5. 敏感数据（Secret）的铁律

### 铁律 1：Secret 只走环境变量

API key、token、密码，**只能**通过环境变量传入。不要提供 `--api-key` 这种 CLI flag——`ps aux` 能看到，shell history 里也会存。

### 铁律 2：不要把 secret 写进配置文件

不管项目级还是全局配置，配置文件都有可能被共享、被 git tracked、被截图发给同事。JSON 文件里出现 `"apiKey": "sk-xxx"` 是事故。

### 铁律 3：不要把 `.env` 提交到 git

即使只是内部工具也要养成习惯。一件工具一旦发布到 NPM，你无法控制用户怎么用它。

### 做对了的例子

```bash
# ✅ 正确：用环境变量
export GITHUB_TOKEN=ghp_xxx
gh pr list

# ✅ 正确：用 .env，但 .env 在 .gitignore 里
# .env
OPENAI_API_KEY=sk-xxx
```

### 做错了的例子

```bash
# ❌ 错误：API key 变成 CLI flag，留在 shell history 里
my-tool --api-key sk-xxx --url https://api.openai.com

# ❌ 错误：secret 在配置文件里
# config.json （如果被提交就是安全事故）
{ "apiKey": "sk-xxx" }
```

## 6. 真实案例：各工具怎么做

### gh (GitHub CLI)

```
优先级：CLI flag > GH_TOKEN / GITHUB_TOKEN 环境变量 > gh auth login 存储的 token
配置文件：~/.config/gh/hosts.yml（只存 token，不存 URL）
```

- Token 通过 `gh auth login` 的 OAuth 流程获取，写入 `~/.config/gh/hosts.yml`，权限 600。
- 也可以用 `GITHUB_TOKEN` 环境变量覆盖。

### aws-cli

```
优先级：CLI flag > 环境变量 > ~/.aws/config + ~/.aws/credentials > IAM role
多 profile 切换：--profile prod
```

- 全局配置 + 多 profile 切换是它的核心设计。
- credential 文件和 config 文件分开。

### eslint / prettier

```
优先级：CLI flag > 项目 .eslintrc / .prettierrc > ~/.eslintrc 全局
```

- 纯行为配置，没有 secret，配置文件直接放项目根目录。
- 项目配置可以 extends 共享配置（npm 包）。

### Vercel CLI

```
优先级：CLI flag > 环境变量 > vercel.json > Vercel 平台设置
Token 管理：vercel login → 存到 ~/.vercel/config.json
```

- 敏感 token 通过 login 命令获取，存全局配置。
- 项目配置 `vercel.json` 只存部署行为。

## 7. 对你这个工具的建议

当前状态：

```
✅ CLI flag（--model-url, --model-key, --model-name 等）
✅ 环境变量（UIUX_AUDIT_MODEL_URL 等）
✅ .env 加载（CWD 的 .env 文件）
✅ 不覆盖已有环境变量
```

如果你想保持简单并发布到 NPM，建议做以下调整：

### 调整 1：把 `--model-key` 从 CLI flag 中去掉

API key 不应该作为 CLI flag。保留环境变量即可：

```bash
# ✅ 用户这样用
export UIUX_AUDIT_MODEL_KEY=sk-xxx
npx uiux-audit --url https://example.com --visual

# ❌ 不要引导用户这样
npx uiux-audit --url https://example.com --visual --model-key sk-xxx
```

### 调整 2：`.env` 放在用户的 CWD，工具自动发现

这个你已经做了（`env.ts`）。保持现状。

### 调整 3：全局配置存默认 model URL 和 model name

如果用户固定用某个模型，可以用一个全局配置文件存非敏感配置：

```
~/.config/uiux-audit/config.json
{
  "modelUrl": "https://open.bigmodel.cn/api/paas/v4",
  "modelName": "glm-4v"
}
```

API key 仍然走环境变量，不写进文件。

### 调整 4：文档里写清楚优先级

在 README 里放一个表就够了：

```
| 配置方式 | 优先级 | 适合 | 不适合 |
|----------|--------|------|--------|
| CLI flag | 最高 | 临时覆盖 | API key |
| 环境变量 | 中 | 生产/CI | 团队共享的行为配置 |
| .env 文件 | 中 | 本地开发 | 生产（CI 有自己的 secrets 管理） |
| 全局配置 | 低 | 长期偏好 | API key |
| 默认值 | 最低 | 开箱即用 | - |
```

## 8. 总结

三层配置足够覆盖 90% 的 NPM CLI 工具：

```
CLI 参数（临时） > 环境变量（secret + 会话级） > 配置文件（持久偏好） > 默认值
```

核心原则：

1. **Secret 只走环境变量**，永远不通过 CLI flag 或配置文件传入。
2. **`.env` 是本地开发的便利工具**，不是安全机制。它只填充用户未手动设置的环境变量。
3. **不需要为了"完整性"设计复杂的配置系统**。没有多供应商切换需求，就保持 CLI flag + env + .env 的极简架构。
4. **全局配置文件只在非敏感、跨项目固定的场景下才有价值**。比如你从 GLM-4V 换到另一个国产模型，改一次全局配置比每次敲 flag 或改 .env 方便。
