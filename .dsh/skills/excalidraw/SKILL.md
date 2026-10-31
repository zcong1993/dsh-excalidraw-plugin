---
name: excalidraw
description: 在 DSH 右侧画布创建、读取、修改并导出官方 Excalidraw 图。当用户要求画架构图、流程图、时序图、思维导图、线框草图，提到 Excalidraw 或 .excalidraw 文件，或要求把现有图导出为 PNG/SVG 时使用；即使用户没有明确说“Excalidraw”，只要目标是可编辑的图，也应使用本 skill。Use this skill whenever the user wants to draw, revise, inspect, or export an editable diagram, architecture chart, flow, mind map, or wireframe, even when they do not name Excalidraw.
whenToUse: 用户说“画一个…”“把这张图改成…”“导出为 PNG/SVG”，或提到现有 .excalidraw 文件时。
user-invocable: true
disable-model-invocation: true
---

# Excalidraw 绘图

本 skill 是 `/excalidraw` 自然语言入口的轻量替代：入口本身不再由插件命令实现，而由当前 Agent 在命中本 skill 后直接调用插件提供的三个原生工具完成。

**前置条件**：当前 Session 必须已启用 `@zcong/dsh-excalidraw-plugin` 插件，且能看到 `excalidraw_scene`、`excalidraw_preview`、`excalidraw_export` 三个工具。缺少工具时直接告诉用户启用该插件；不要用普通文件写入、shell 或新增服务器绕过它。

## 核心原则

- 用户只描述需求，你负责布局、坐标、文字测量、绑定和样式。插件只执行与校验，不做高层自动布局。
- **先让用户看到，再继续画**。从零创建时，第一步永远是 `create` 一个最小可用的骨架并立即 `excalidraw_preview` 打开，然后用 `begin → update` 增量补细节；不要等整张图画完才打开预览。
- 源文件是唯一事实。不要给用户打印原始 JSON；用一句话说明已创建/修改了什么，并把画布打开给用户看。
- 路径相对当前 Session 工作目录，必须以 `.excalidraw` 结尾。创建使用 `create`，目标必须不存在；修改使用 `begin → update → end`，不要无条件覆盖。
- 用户手动编辑后，先读最新基线再改；不要根据旧摘要覆盖用户的新位置或新文字。
- **不要擅自导出**。导出会弹下载 / 保存对话框，只在用户明确要求时执行；改完图默认停在“已保存”，把是否导出留给用户决定。
- 一张图一个页面。若存在多个候选 `.excalidraw` 且用户没有指明目标，先问用户，不要凭历史猜测。

## 工作流

### 1. 确定目标

- 用户给了路径：直接使用。
- 用户没给：选择一个描述性的 kebab-case 文件名，如 `user-gateway-service-db.excalidraw`，放在当前目录。
- 当前目录已有图：先 `excalidraw_scene {action:"read", path:"...", format:"summary"}` 看清结构，再决定新建还是修改。多个候选时先问。

### 2. 先建最小画布并打开预览

先用 `create` 写入骨架（3–5 个主节点，或一条主线；暂不画箭头、装饰和长文案）：

```text
excalidraw_scene {
  action: "create",
  path: "<name>.excalidraw",
  document: { type: "excalidraw", version: 2, elements: [...], appState: {...}, files: {} }
}
```

**然后立刻打开画布**，不要先补完再打开：

```text
excalidraw_preview { path: "<name>.excalidraw" }
```

画布初始只读，用户空闲时可点“编辑”。目标是在几秒内让用户在右侧看到东西；之后画布会自动跟随源版本变化，不要在每次修改后重复打开。

### 3. 增量补全细节

用 `begin → update` 分批补齐箭头、文字、装饰和配色，不要整图重写：

```text
excalidraw_scene { action: "begin", path: "<name>.excalidraw" }
excalidraw_scene { action: "update", transactionId: "<id>", expectedVersion: "<version>", updates: [...] }
```

`update` 的规则见下面“修改现有图”。

每个元素至少要有：

- 稳定且唯一的 `id`、标准 `type`
- 有限数值的 `x`、`y`、非负 `width`/`height`
- 文字元素：`text`、`fontSize`、`fontFamily`、`textAlign`、`verticalAlign`
- 线/箭头：`points: [[x0,y0],[x1,y1],...]`
- 容器文字：文字 `containerId` 指向容器，容器 `boundElements` 包含 `{type:"text", id:"文字 id"}`
- 图片：`fileId` 必须出现在 `files` 中，且只能是经过验证的 PNG/JPEG/WebP/GIF data URL

**中文**：`fontFamily: 5`（Excalifont，官方字体包带 Xiaolai 中文回退）。文字宽度按内容估算，宁可留足空间，不要让文字溢出容器。

简单架构图建议：横向 4 个节点，每个 170×70，间距 110；箭头高度与节点中心对齐；配色用浅底色 + 深色描边，例如蓝 `#1971c2/#e7f5ff`、绿 `#2f9e44/#ebfbee`、橙 `#e8590c/#fff4e6`、紫 `#6741d9/#f3f0ff`。

### 4. 修改现有图

先读：

```text
excalidraw_scene { action: "read", path: "<name>.excalidraw" }
```

再开事务：

```text
excalidraw_scene { action: "begin", path: "<name>.excalidraw" }
```

`begin` 会先 flush 用户在画布上的草稿，返回 `transactionId`、`version`、`deadlineAt` 和场景内容。然后用 `updates` 局部修改（推荐），或 `document` 整图替换：

```text
excalidraw_scene {
  action: "update",
  transactionId: "<id>",
  expectedVersion: "<version>",
  updates: [
    { id: "node-a", patch: { x: 40, backgroundColor: "#d0ebff" } },
    { id: "note-1", patch: { type: "text", x: 40, y: 180, width: 300, height: 25, text: "新增说明", fontSize: 20, fontFamily: 5, textAlign: "left", verticalAlign: "top", strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, angle: 0, groupIds: [], boundElements: [], isDeleted: false, link: null, locked: false } }
  ]
}
```

规则：

- `updates` 最多 200 项，浅合并；`patch.id` 禁止。
- 新增 id 必须同时给 `type`、`x`、`y`、`width`、`height`。
- 软删除用 `{id, patch:{isDeleted:true}}`；恢复用 `{id, patch:{isDeleted:false}}`。
- `expectedVersion` 必须来自刚返回的 `begin`；版本过期直接报 `VERSION_CONFLICT`，不要自动重试或重读洗掉版本保护。
- 事务最长 120 秒；失败或完成后用 `end` 释放（`update` 成功会自动结束）。不要在失败后继续用旧 `transactionId`。
- 纯平移容器时可以同步移动用户未显式修改的绑定文字；不要自动重排或缩放连线。

### 5. 导出

**只有用户明确要求导出时才调用**（“导出成 PNG”“给我一个 SVG”“发我一张图”这类）。不要因为“顺便”“验收”“检查效果”就去导出：导出会触发浏览器下载 / 保存弹窗，打断用户，体验很差。

用户没有要求时，改完图就停下，让用户自己决定要不要导出。

导出前先确保画布已打开：

```text
excalidraw_export { path: "<name>.excalidraw", format: "png", scale: 2, transparent: false }
```

- 一次请求只导出用户要的格式和尺寸，不要顺带导出多种。
- PNG 默认 2×，可用 1/2/3；SVG 为矢量并内嵌字体。
- 导出的是整张图，不是视口截图；空图、断线、超限会明确失败。
- 成功结果包含文件附件和 60 秒有效的下载链接。告诉用户已导出，不要声称未返回的附件已保存。

## 输出与协作

- 创建/修改完成后只回一句：文件路径、版本、做了什么、画布已打开。
- 用户在画布上编辑后：等用户发下一条消息；系统会把已提交变化摘要附到消息里。你先读最新文件，再在此基础上修改。
- Agent 工作期间画布只读；不要在 working 时尝试提交用户编辑。
- 不要外部嵌入、链接导航或远程 SVG 图片；粘贴图片只在可编辑状态进入源图。
- 参考图片：按普通图片附件阅读，用来理解布局和风格，不要把它直接当成可编辑源文件。

## 失败时

- `PATH_EXISTS`：改用 `read` + `begin/update`，不要换路径覆盖。
- `VERSION_CONFLICT`：停止自动保存，读最新文件；需要时让用户选择“加载最新”或“下载草稿”。
- `LOCKED`：Agent 正在处理；等 idle 再编辑。
- `NO_PAGE`：先 `excalidraw_preview`，再导出。
- `DOCUMENT_TOO_LARGE` / `EMPTY_SCENE` / `EXPORT_TOO_LARGE`：按错误信息缩减图或减少元素/缩放。

## 示例

用户：`画一个用户→网关→服务→数据库的架构图`

1. `excalidraw_scene create` 先只写入四个节点，文件名 `user-gateway-service-db.excalidraw`。
2. 立刻 `excalidraw_preview` 打开右侧画布，让用户先看到骨架。
3. `begin → update` 补三条箭头和配色。
4. 回复：`已创建 user-gateway-service-db.excalidraw（4 个节点、3 条箭头，版本 …），画布已在右侧打开。`

用户：`把当前图节点统一尺寸，保留我刚调整的位置`

1. `read` 当前图，确认节点 id。
2. `begin`，再 `update` 只改 `width/height`，坐标保持 `begin` 返回的当前值。
3. 回复修改数量；画布自动刷新。
