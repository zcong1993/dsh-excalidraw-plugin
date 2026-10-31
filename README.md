# Excalidraw for DeepSeek Harness

在 DeepSeek Harness（DSH）右侧边栏里直接使用官方 Excalidraw 画布：用一句话让 Agent 画图，你在同一张画布上继续修改，最后导出 PNG / SVG。

它是一个独立的 DSH Cordis 插件，所有图形都落在工作区里真实的 `.excalidraw` 文件上——Agent 和你编辑的是同一个源文件，不是截图、也不是外部服务里的副本。

## 特性

- **自然语言绘图**：由 `excalidraw` skill 驱动，Agent 调用原生工具创建、读取、局部修改图形。
- **官方画布**：内置 `@excalidraw/excalidraw@0.18.0`，右侧边栏即官方编辑器，支持选择、绘制、文字、图片、缩放和平移。
- **完全本地资产**：画布、样式、234 个 WOFF2 字体（含中文字体 Xiaolai）全部随包分发，不使用 CDN，离线可用。
- **人机协作**：你编辑时自动保存；Agent 处理期间画布只读；双方通过版本化事务和 `opId` 幂等提交，不会互相覆盖。
- **草稿与冲突保护**：未保存内容存放在浏览器 `sessionStorage`；检测到外部修改时停止自动保存并提供下载草稿 / 加载最新。
- **两种导出**：工具栏「导出」菜单直接把当前画面（含未提交编辑）下载到本地；`excalidraw_export` 工具则走 Host 校验并保存为会话附件。
- **安全边界**：写入走 Session 沙箱与 `createIfAbsent` / `replaceIfVersion`；拒绝符号链接、外部嵌入、脚本、远程资源和内联事件。

## 环境要求

| 项目 | 要求 |
| --- | --- |
| DSH | `0.2.1-rc.5`（`engines.dsh` 已声明） |
| 运行环境 | 桌面客户端或 Web GUI，插件安装在同一个 profile |
| 开发环境 | Node 24、pnpm 11、Bun 1.3（仅用于构建与测试） |

## 安装

### 1. 安装插件

从 npm 安装到当前 profile：

```text
plugin_manager install_bundle @zcong/dsh-excalidraw-plugin@0.3.9
```

或者手动把它加入 profile 的 `package.json` 并启用：

```json
{
  "dependencies": {
    "@zcong/dsh-excalidraw-plugin": "^0.3.9"
  },
  "dsh": {
    "profile": {
      "bundles": ["@zcong/dsh-excalidraw-plugin"]
    }
  }
}
```

插件只注册 Host 服务、HTTP 路由、三个原生工具和 `excalidraw` skill，不启动额外服务器，也不新增端口。

### 2. skill 已随插件注册

自然语言入口 `excalidraw` 由插件在启动时用 `ctx.skills.register()` 注册，不需要手动复制文件，也不需要 `/excalidraw` 命令。

如果想自定义措辞，把仓库里的 `.dsh/skills/excalidraw/` 复制到下面任一位置即可覆盖运行时版本（项目级优先于运行时）：

```text
<工作区>/.dsh/skills/excalidraw/      # 只对当前工作区生效
~/.agents/skills/excalidraw/          # 对所有工作区生效
```

### 3. 从源码构建

从仓库安装或修改代码时：

```bash
git clone https://github.com/<owner>/dsh-excalidraw-plugin.git
cd dsh-excalidraw-plugin
pnpm install
bun run build
```

`build:canvas` 重建 `lib/client.js` 与 `lib/assets/`，`build:host` 生成 `lib/host.js`；两者顺序不可颠倒。改完代码后安装本地目录：

```text
plugin_manager install_bundle /absolute/path/to/dsh-excalidraw-plugin
```

## 快速开始

直接对 Agent 说：

```text
画一个用户 → 网关 → 服务 → 数据库的架构图
把当前图里的节点统一尺寸，保留我调整过的位置
把这张图导出成 PNG
```

Agent 会依次调用 `excalidraw_scene`（创建/修改）、`excalidraw_preview`（打开画布）、`excalidraw_export`（导出）。画布打开后：

1. 未进入编辑时画布只读，可以缩放、平移、框选查看；
2. 点击「编辑」进入编辑模式，修改会自动保存（500 ms 防抖）；
3. 点击「完成编辑」提交并退出编辑；
4. 需要文件时，用「导出」菜单或让 Agent 调用导出工具。

## 画布界面

| 控件 | 说明 |
| --- | --- |
| 状态点 / 文案 | 已保存、未保存、保存中、连接中断、连接失效、只读、Agent 正在处理 |
| 编辑 / 完成编辑 | 进入或退出编辑；Agent 处理中或存在同文件事务时禁用 |
| 重新加载 | 重新读取源文件；断线状态下会重建连接 |
| 导出 | `PNG 2×`、`PNG 3×`、`SVG`，下载当前画面，不创建 Host 任务、不写附件 |

连接断开时客户端会自动重连（只读且无未保存修改时，最多 3 次）；仍无法恢复时刷新页面即可。

## Agent 工具

| 工具 | 作用 |
| --- | --- |
| `excalidraw_scene` | 对 `.excalidraw` 执行 `create` / `read` / `begin` / `update` / `end`。`begin` 锁定一个版本并返回 `transactionId`，`update` 用 `expectedVersion` 防止覆盖。 |
| `excalidraw_preview` | 在右侧边栏打开画布，初始只读。 |
| `excalidraw_export` | 刷新用户草稿、锁定版本，由页面用官方渲染器输出 PNG/SVG，校验后保存为附件并返回 60 秒下载链接。 |

路径都相对当前 Session 的工作目录，且必须以 `.excalidraw` 结尾。读取默认返回有界摘要（`limit` 1–200，默认 50，支持 `offset` / `ids`），`format: "document"` 返回完整 JSON；未知的顶层字段和 `appState` 字段会原样保留。

## 诊断命令

低层入口仍保留两个命令，便于排查问题：

```text
/excalidraw-scene {"action":"read","path":"diagram.excalidraw"}
/excalidraw-export {"path":"diagram.excalidraw","format":"png","scale":2}
```

## 数据与隐私

- 图形文件保存在你的工作区，插件不上传任何内容，也不访问外部服务；
- 画布运行时与字体随包分发，不请求 CDN；
- 嵌入图片必须是校验过的 PNG / JPEG / WebP / GIF data URL；
- HTTP 路由仅接受 DSH owner 浏览器，写入经过 Session 沙箱策略。

## 限制

| 项目 | 限制 |
| --- | --- |
| 源文件 / 导出体积 | 32 MiB |
| 元素数量 | 50,000 |
| 单次 patch | 200 个元素 |
| 摘要分页 | 200 个元素（默认 50） |
| 草稿恢复 | 2 MiB（UTF-16 估算） |
| 保存 flush | 10 秒 |
| 事务有效期 | 120 秒 |
| PNG 像素 | 16,777,216 像素，单边 16,384 |
| 用户改动摘要 | 100 条 / 约 32 KiB，超出明确截断 |

## 常见问题

**Agent 已经空闲，画布却还显示「Agent 正在处理，画布暂时只读」？**
说明客户端与 Host 的连接失效了，界面停留在最后一次轮询的状态。新版客户端会自动重连并在工具栏显示「连接失效 / 连接中断」；如果仍未恢复，刷新页面（桌面客户端可完全退出后重开）。

**更新插件后界面没有变化？**
桌面客户端不会热重载插件的前端 bundle。修改后端可以只重载插件，修改前端需要完全退出客户端再打开。

**提示「这个文件不是 Excalidraw 源文件」？**
只接受 `.excalidraw` 扩展名且内容为合法 Excalidraw JSON 的文件；符号链接会被拒绝。

## 开发

- 工程规范：[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- 原始功能规格：[docs/spec.md](docs/spec.md)

```bash
pnpm install
bun run build     # build:canvas → build:host
bun test
```

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `src/host/` | Host 插件：工具、命令、HTTP 路由、事务与 flush |
| `src/client/` | 浏览器插件：画布、自动保存、草稿、冲突、导出 |
| `src/canvas/` | 官方画布入口与构建脚本 |
| `lib/` | 构建产物（不提交） |
| `tests/` | 文档、服务、草稿、布局回归测试 |
| `.dsh/skills/excalidraw/` | 自然语言入口 skill |
| `docs/` | 开发规范与规格 |

## 贡献

欢迎 issue 和 pull request。提交前请先阅读 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)，并确保 `bun test` 与 `bun run build` 通过。

## 许可证

[MIT](LICENSE)。内置的 Excalidraw 运行时遵循其自身许可，相关声明见 `lib/assets/LICENSE-excalidraw` 与 `lib/assets/THIRD_PARTY_NOTICES.md`。
