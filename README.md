# dsh-session-hub

让 [DSH](https://github.com/deepseek-ai) 会话互相派活，任务完成后把回复自动带回发起会话。插件提供 `session` 工具管理会话，无需修改 DSH 源码。

[![项目负责人从协作专家列表查看前后端负责人的任务状态。点击打开演示。](docs/screenshots/release-running.webp)](https://duo121.github.io/dsh-session-hub/)

**[打开交互演示 ↗](https://duo121.github.io/dsh-session-hub/)** · 浏览器里的模拟工作区，无需安装 DSH。

## V1.8 发布演示

点左侧「新会话」并跟随箭头。手机上先点左上角打开会话列表。也可点右上角「自动播放」看完整流程，随时暂停并从当前步骤继续播放。给演示地址加上 `?lang=en` 可以查看英文工具摘要。

1. **创建会话。** 点「新会话」进入空白对话，发送指令让 AI 调用 `session · 将会话改名为「项目负责人」`。接着让 AI 创建前端和后端负责人，并置顶项目负责人会话。
2. **派发并收回执。** 用 `@` 引用前端负责人后发送任务。协作专家列表自动展开，点击可查看进度。后端发现检查范围有变时，由 AI 中断旧任务，再派发新版接口检查。两项完成的检查各回执一次。
3. **复核并收尾。** 让 AI 归档再恢复前端会话。发送一条指令，AI 依次查找会话、读取前端摘要和后端完整对话，再给出发布检查汇总。每次调用都可以在对话里展开查看。随后让 AI 取消置顶并归档前后端会话，派发记录和回执保留在项目负责人会话。

![项目负责人在「收到任务消息」通知中展开后端负责人的自动回执](docs/screenshots/release-receipts.webp)

<details>
<summary>查看从新建到归档的演示截图</summary>

![入口可手动新建空白会话或自动播放](docs/screenshots/release-start.webp)

![发送自然语言消息后，AI 调用 session rename 并更新会话标题](docs/screenshots/release-rename.webp)

![新建前后端负责人后，项目负责人置顶，图标位于会话行右侧](docs/screenshots/release-prepare.webp)

![前端负责人收到来源为项目负责人的任务](docs/screenshots/release-receiver.webp)

![一条消息触发三次读取，发布检查汇总留在同一轮对话](docs/screenshots/release-summary.webp)

![发布结果已汇总，两个协作会话已归档](docs/screenshots/release-close.webp)

</details>

<details>
<summary>查看原版 DeepSeek Harness 界面参考</summary>

演示的品牌区、会话布局、置顶图标、协作专家列表和引用选择器均参考了原版界面截图。[工作区与输入框](docs/screenshots/harness-reference.webp) · [置顶会话](docs/screenshots/harness-pin-reference.webp) · [会话与工具调用](docs/screenshots/tool-call.webp) · [协作专家列表](docs/screenshots/menu-open.webp) · [会话引用选择器](docs/screenshots/at-picker.webp)

![隔离实例中的 DeepSeek Harness 工作区](docs/screenshots/harness-reference.webp)

</details>

## 功能

| 功能 | 说明 |
| --- | --- |
| 会话浏览 | 列表（标题、轮数、来源、归档/置顶）、逐轮摘要、完整对话文本，按关键词搜正文 |
| 会话写操作 | 新建（可同时命名）、改名、发消息、中断、归档、取消归档、置顶、取消置顶 |
| 工具调用摘要 | 折叠时显示「向『后端负责人』发送消息」这类操作说明。文案跟随 DSH 界面语言，展开可查看原始参数和结果 |
| 协作专家指示 | 头部显示「N 个协作专家」，悬停列出往来会话（方向、标题、最近往来、状态），点击跳转 |
| 自动回执 | `send` 传 `receipt: true`，目标会话这一轮自然结束时，最终回复自动发回本会话 |
| 发送方标注 | 消息正文首行是发送方的会话引用标签 |

## 安装

```bash
# 1. 放到本地插件目录（或任意位置）
cp -R dsh-session-hub ~/.dsh-local-plugins/

# 2. 在 profile 的 package.json 挂载
{
  "dependencies": {
    "@local/dsh-session-hub": "link:~/.dsh-local-plugins/dsh-session-hub"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@local/dsh-session-hub"
      ]
    }
  }
}
```

重启 `dsh web` 生效。

> 本仓库的 `package.json` 用公开包名 `dsh-session-hub`；本地挂载时请把 `name`、`cordis.patch.yml` 里的包名、以及 `client.js` 顶部的模块 `id` 统一改成你实际使用的包名（本地习惯用 `@local/dsh-session-hub`）。三者必须一致，否则客户端插件会加载失败。

## session 工具速查

`action` 必填。原先省略 `action` 的调用需要显式传 `action: "read"`。

| 参数 | 作用 |
| --- | --- |
| `action=read` | 只读：列会话清单（可传 `query` 粗筛）；传 `session_id` 看逐轮摘要；再传 `mode`（summary/dialog/full）看全文 |
| `action=create` | 新建会话（`title` 可同时命名，`cwd` 指定工作目录）。注意：同一工作区里若已有**没开始过回合**的空白会话，控制器会直接复用那个（结果里会明确提示「复用了已有的空白会话」），不会多出一个新会话 |
| `action=rename` | 改名（`content` 即新标题） |
| `action=send` | 发消息（`content` 必填；`receipt: true` 要求自动回执；跨工作目录需显式传 `cwd`） |
| `action=interrupt` | 中断目标当前轮（保留队列） |
| `action=archive` / `unarchive` | 归档 / 取消归档（归档运行中会话需 `confirm: true`） |
| `action=pin` / `unpin` | 置顶 / 取消置顶 |

## 安全约束

- 不能给子智能体会话发消息（子会话由 subagent 路由持有）。
- 归档会话必须先取消归档才能发消息。
- 发消息默认只允许同一工作目录，跨目录要显式传 `cwd`。
- **不能发给自己**：自己不是自己的协作专家，`send` 到本会话会被直接拒绝，也不计入协作专家列表。
- A→B→A 回环自动拒绝；同一对会话的自动回执每次进程生命周期只回一次（防循环，进程内账本，重启重置）。

## 已知限制

- 循环防护账本是进程内的，宿主重启后同一对会话可再回执一次。
- `receipt` 的自动回执只覆盖目标「正常结束」的轮次；被中断或报错的轮次不回执。
- 归档会话无法直接打开：DSH 对已归档会话不保留会话引用（`is released`），插件改为标注「已归档」并在点击时提示先取消归档，不会擅自改动你的归档状态。

## 目录结构

```
dsh-session-hub/
├── index.js          # session 工具 + 协作专家投影 + 自动回执
├── client.js          # 头部协作专家指示（计数 + 悬停列表）
├── package.json       # 清单（exports、dsh.client 配置）
├── cordis.patch.yml   # bundle 挂载声明
├── locale/            # zh / en 词典
├── docs/
│   ├── DETAIL.md      # 插件详情（英文）
│   ├── DETAIL.zh.md   # 插件详情（中文）
│   └── screenshots/   # 文档截图
└── icon.svg
```

## 联系与交流

用的时候遇到问题、有想法想聊，或者想看看别人怎么用，都欢迎来交流。

- **微信**：`jianduo1`（加我时说一声 `dsh-session-hub`，方便我备注）
- **智能体交流群**：加微信后我拉你进群，一起聊 DSH 插件、跨会话协作这些玩法
- **提问题 / 提需求**：[Issues](https://github.com/duo121/dsh-session-hub/issues)，欢迎 PR

## License

[MIT](LICENSE)
