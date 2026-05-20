# Flow: 业务流程驱动的 UX 审计

## 背景

uiux-audit 原有三个核心特性：Journey（预置状态）、Explore（自主发现）、AI Agent 集成（CLI + JSON）。但缺少一个关键能力：**按业务流程逐步审计**。

自主探索解决"我不知道这个网站有什么"，但无法解决"我知道业务应该怎么走，帮我检查这条路走不走得通"。后者才是业务级审计——AI 瞎点能发现 tab 切换有问题，但永远不会知道"下单→选地址→付款→确认"这条链路中间哪一步的 UX 有问题。

## 核心概念

Flow 是一个描述业务流程的文件，工具按流程逐步执行，在检查点处停下来做 a11y + layout + visual 审计。

## 文件结构

### setup + steps 二段式

```yaml
name: 下单流程
setup: ./login.yaml            # 引用已有 journey 文件
steps:
  - goto: /products
  - checkpoint: true
  - click: .product-card:first-child
  - checkpoint: true
  - click: button.add-to-cart
  - checkpoint: true
  - click: a.checkout
  - checkpoint: true
  - fill: { selector: input[name="address"], value: "测试地址" }
  - click: button.place-order
  - checkpoint: true
```

setup 也可以内联，不引用外部文件：

```yaml
name: 下单流程
setup:
  - goto: /login
  - fill: { selector: input[name="email"], value: "${LOGIN_EMAIL}" }
  - fill: { selector: input[name="password"], value: "${LOGIN_PASSWORD}" }
  - click: button[type="submit"]
  - waitFor: .dashboard
steps:
  - goto: /products
  - checkpoint: true
  - click: .product-card:first-child
  - checkpoint: true
```

### 语义规则

| 区域 | 是否审计 | 说明 |
|------|---------|------|
| `setup` | 否 | 只是到达起点，不触发任何检查 |
| `steps` 中 `checkpoint: true` | 是 | 停下来做 a11y + layout + visual 审计 |
| `steps` 中无 checkpoint | 默认是 | 如果整个 steps 里没有任何 checkpoint，则每一步执行后都审计 |

### 为什么这样设计

1. **一个文件就是一个完整的业务场景。** 不需要在命令行拼 `--journey login.yaml --flow checkout.yaml`，直接 `--flow checkout.yaml` 就够了。
2. **Journey 仍然独立存在。** 简单场景（只想登录然后自主探索）用 `--journey`，复杂场景（要走业务流程）用 `--flow`。Journey 是 Flow 的子集，不是替代品。
3. **复用不冲突。** 多个 Flow 共享同一个登录 Journey，改一处就行。单独的 Flow 也可以内联自己的 setup，不依赖外部文件。
4. **结构本身表达意图。** setup 里的步骤永远不会触发审计，steps 里的 checkpoint 才会。不需要靠"有没有 checkpoint"来推断意图。

## 与现有特性的关系

### Flow vs Journey

| | Journey | Flow |
|---|---|---|
| 目的 | 到达某个状态（登录、设置） | 验证一条业务路径的 UX |
| 审计时机 | 执行完就结束，不审计 | 每个检查点停下来审计 |
| 输出 | `storageState`（cookies/localStorage） | 每个检查点的审计报告 |
| 关系 | Flow 的 setup 可以引用 Journey |  |

### Flow vs Explore

| | Flow | Explore |
|---|---|---|
| 问题 | 这条业务路径走不走得通、UX 好不好 | 还有没有我没覆盖到的页面 |
| 输入 | 用户提供的业务逻辑 | URL（自主发现） |
| 覆盖面 | 窄但深 | 宽但浅 |

### 协作方式

Flow 跑过的页面作为已知页面传给 Explore，Explore 跳过这些页面只发现新内容。

```bash
uiux-audit http://localhost:5173 --flow checkout.yaml --explore
```

执行顺序：Flow setup（Journey）→ Flow steps（每步审计）→ Explore（补漏）

## 命令行接口

```bash
# 只跑业务流程
uiux-audit http://localhost:5173 --flow checkout.yaml

# 业务流程 + 补漏探索
uiux-audit http://localhost:5173 --flow checkout.yaml --explore

# 多个业务流程
uiux-audit http://localhost:5173 --flow checkout.yaml,refund.yaml
```

## 探索模式的光谱

从"纯自主"到"纯引导"：

| 模式 | 输入 | 行为 |
|------|------|------|
| 纯自主 | 只给 URL | 现有的 `--explore`，AI 或 DOM 爬 |
| 种子引导 | sitemap / URL 列表 | 沿已知路径探索，每个页面上的交互仍自主发现 |
| 流程引导 | Flow 文件 | 按业务流程逐步执行，检查每一步的 UX |
| 纯回放 | Journey YAML | 现有的 `--journey`，到达状态后审计 |

## 待定事项

- [ ] setup 引用 Journey 时，是否支持传参（如不同的测试账号）
- [ ] Flow 的 steps 是否支持条件分支（如"如果出现弹窗则关闭"）
- [ ] 多个 Flow 之间的状态是否共享（同一个 `storageState` 还是各自独立）
- [ ] 种子引导模式（sitemap 输入）的具体格式
