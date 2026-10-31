# dsh-excalidraw-plugin 功能清单与复刻规格

> 教学基准：当前原生绘图功能；按题设，将 `/excalidraw` 自然语言入口视为已实现。本清单是从零实现的目标规格，不表示该假定入口已在现有安装中上线。

## 1. 产品定义

在 **DSH 现有 Web GUI** 内完成：

**一句话绘图 → 生成可编辑源文件 → 右侧预览 → 用户编辑并保存 → Agent 接着修改 → 官方 PNG/SVG 导出。**

独立 Cordis 插件，使用官方 Excalidraw；不修改 DSH 本体、不新增服务器/端口/iframe，不依赖独立 CLI 或外部 `excalidraw-cli` Skill。

## 2. 最终功能清单

| 功能 | 必须实现的行为 |
| --- | --- |
| 精准入口 | `/excalidraw <自然语言需求>`，支持创建、修改和导出意图，可附参考图片；需求交给当前 Agent，执行使用原生工具，无需用户编写 JSON。 |
| 原生创建 | 创建标准 `.excalidraw` 文件；目标路径必须不存在，包括不得覆盖文件、目录或既有符号链接；返回真实文件版本。 |
| 原生读改写 | 有界读取、按 ID 读取、完整文档读取、版本化局部增改、软删除、显式整图替换。 |
| 右侧画布 | 工具或文件链接打开官方画布；初始只读，可缩放、平移、适应画布；文件变化自动显示。 |
| 用户编辑 | idle 时点击“编辑”；支持标准形状、文字、线/箭头、自由绘制、frame 及受支持的嵌入图片。调整位置、大小、配色、文字和绑定。 |
| 自动保存 | 停止连续修改约 500 ms 后提交；串行保存，显示未保存/保存中/已保存/冲突/断线/锁定；结束编辑前保存。 |
| Agent 协作 | 当前 Session working 时，它的全部 review 画布只读；保存用户草稿后 Agent 读取最新基线再修改；idle 后允许用户继续编辑。 |
| 用户修改摘要 | 用户发送下一条消息时，附带已提交变化的文件、版本、元素增删及字段前后值；有界、可在 Session 日志中重建。 |
| 草稿保护 | 失败不丢稿；支持下载草稿、明确确认后加载最新文件、重新连接及适用条件下的保存重试。 |
| 官方导出 | PNG 1×/2×/3×，默认 2×；SVG 矢量及字体内嵌；可选透明背景；导出整图而非视口截图。 |
| 中文与样式 | 官方字体随插件本地打包，包含中文字体；默认手绘风格，可按需求调整。 |
| 准确交互 | 画布移位或侧栏布局变化后，鼠标命中、拖动、绘制与滚轮中心仍和画布一致。 |

### 使用示例

```text
/excalidraw 画一个用户→网关→服务→数据库的架构图
/excalidraw 把当前图的节点统一尺寸，保留我刚调整的位置
/excalidraw 将当前图导出为 PNG 和 SVG
```

入口只负责把需求、附件及必要绘图上下文提交给当前 Agent；不另起 Agent、服务器或绘图引擎。未指定图且当前有多个候选时询问目标；不根据一张图的历史记录覆盖另一张图。

**布局、坐标、文字测量和绑定由 Agent 提供；插件负责执行与安全，不内置高层自动布局。**

## 3. 原生工具契约

### `excalidraw_scene`

| action | 输入 | 输出与语义 |
| --- | --- | --- |
| `create` | `path`、完整 `document` | 不存在才创建；返回 `created:true`、`path`、`version` 和有界摘要；不补默认值、不自动打开。 |
| `read` | `path` 或 `transactionId` | 按路径先 flush 再读，结束临时锁；按事务 ID 读取同一锁定基线。 |
| `begin` | `path` | flush 可达编辑端草稿并锁定源快照，返回 `transactionId`、`version`、`deadlineAt` 及场景内容。 |
| `update` | `transactionId`、`expectedVersion`；`updates` 或 `document` 二选一 | 基于原始基线提交一次，结束事务；旧版本或失败不自动重试、重读洗掉版本保护。 |
| `end` | `transactionId` | 放弃尚未提交的事务，释放锁；不改变源图。 |

- 路径相对发起 Session 工作目录；只接受 `.excalidraw`。
- 默认 `format:"summary"`；`limit` 默认 50、范围 1–200，支持 `offset` 及最多 200 个 `ids`，提供分页/截断标记。摘要不包含图片字节或私有未知字段。
- `format:"document"` 返回完整 raw JSON；不能与摘要的 `ids/offset/limit` 混用。
- `updates` 为 1–200 个 `{id,patch}`；浅合并保留未涉及字段，禁止 `patch.id`。新增 ID 至少需要类型及完整几何；软删除用 `isDeleted:true`。
- `document` 是整份文档，省略的内容会被移除；不能用摘要构造无损替换。
- 支持显式文字、尺寸、points、双向绑定及 frame 关系；纯平移容器时可同步移动未显式修改的绑定文字，不自动重排或缩放连线。

### `excalidraw_preview`

输入 `{path}`；在当前 Session 右侧打开既有图，返回解析路径、Session 和源版本。初始只读，后续用户编辑和自动保存沿用同一文件；不每次修改都重开画布。

### `excalidraw_export`

输入 `{path,format?,scale?,transparent?}`：`format` 默认 `png`，`scale` 默认 2，`transparent` 默认 false。

先 flush 并锁定源快照，再由已连接的 owner DSH 页面调用官方 `exportToBlob`/`exportToSvg`。成功返回文件附件、源路径/版本及下载地址；UI 自动下载并保留链接，临时下载地址有效 60 秒。空图、断线、超限或资源不安全须明确失败；附件保存失败不得报告成功。无需当前浏览器停留在发起 Session。

保留低层直接命令 `/excalidraw-scene <JSON>` 和 `/excalidraw-export <JSON>`，供诊断和确定性操作；它们不替代自然语言入口。

## 4. 文件、权限及协作规则

**源文档**采用 `{type:"excalidraw",version:2,elements:[...],appState?,files?}`。稳定且唯一的元素 ID、显式有限坐标、非负宽高、类型所需文字/points/资源字段及一致绑定均由调用方提供。拒绝非法 JSON、重复 ID、非有限数字及有损序列化输入。

**数据分离**：完整 raw 源、用于显示的净化场景、官方恢复基线、用户草稿、视口各自独立。保留未涉及的未知字段、隐藏/删除元素、资源及 appState；显示净化结果不能写回源文件。缩放、平移和选择不触发源文件保存。

**授权写入**：使用发起 Session 的文件服务及当前 sandbox policy。创建固定使用 `createIfAbsent`；更新固定使用原始基线的 `replaceIfVersion`，记录正/负文件 observation。禁止 Node fs 绕过授权，禁止无条件覆盖；只读或无授权写入能力的后端不能编辑。源文件已提交但记账失败时保留已提交路径/版本并明确警告。

**协作锁**：每个 canonical 文件/执行世界协调临时编辑连接和事务；同一图由用户保证只在一个 Web 页面编辑。working 锁与事务锁独立，事务结束不提前解锁仍在 working 的 Session。不同图可同时 review，不拦截其他 Session 的普通工具。

**保存一致性**：同一连接使用源版本及 operation ID；响应丢失重试同一提交，新草稿不被旧 ACK 清掉。用户消息触发 flush，只有已提交变化才能进入修改摘要。失败、截断或无历史基线须标明；自动保存不主动唤醒模型。

**冲突与恢复**：外部变化遇到脏稿停止自动保存，不自动语义合并；断线冻结编辑并保留草稿，可重新连接但不得重新绑定旧稿为新版本。不可达端 flush 超时明确失败，后续无编辑端的读取只含已提交文件。用同标签页 `sessionStorage` 保存有界恢复稿，不保存连接 token；存储不足/大场景保留可下载内存稿，不能保证浏览器彻底关闭后的恢复。

**显示安全**：禁止外部嵌入、链接导航及远程/主动 SVG 图片资源；允许经过验证的嵌入栅格资源。官方导出结果也验证 PNG/SVG 安全性。未经允许的粘贴不得进入源图。

**交互正确性**：输入 capture 阶段比较本实例 DOM 原点与官方偏移，必要时通过共享 `react-dom.flushSync` 同步提交官方公开 `refresh`；保留亚像素值。不得通过重新加载场景、清 Undo、重置视口或改事件坐标“修复”鼠标错位。

## 5. 从零复刻架构

```text
/excalidraw → 当前 Agent → scene / preview / export 工具
                            ↓
                 Host：授权文件操作、事务、flush、导出任务
                            ↕ DSH 既有连接
                 Client：官方画布、草稿、保存、渲染导出
```

| 模块 | 责任 |
| --- | --- |
| Bundle | 包清单、Cordis patch、中英 metadata、自有/合法图标、资源与许可。 |
| 入口 | `/excalidraw` 自然语言及附件 → DSH 模型请求；原始需求和上下文可在日志中重建。普通 command 默认不进模型，不能只注册一个返回 success 的 handler。 |
| Host | 注册三种工具及低层命令；解析精确 Agent/Session 服务；校验、路径身份、版本、事务及临时连接；挂载编辑与导出接口。 |
| Client | 在 `sidebar.right.tab.document` 注册 `.excalidraw` renderer；宿主共享 React；会话状态、文件订阅、草稿控制器、500 ms 保存、错误恢复、准确坐标、中文 UI。 |
| 官方运行库 | Excalidraw 独立 lazy chunk；React/ReactDOM external；CSS 限定插件 wrapper；字体本地内嵌，保留许可。 |
| 导出 worker | 页面端领取授权任务、读取锁定源、官方渲染、上传附件结果；Host 验证并持久化。 |

实现必须使用当前 DSH Inspect 核实的 Service/Event/Slot API；业务逻辑由插件共享，不在 UI 与工具中各写一套。

- 编辑接口：`POST /api/excalidraw-edit/{open,snapshot,commit,poll,ack,close}`，共6个。
- 导出接口：`POST claim/fail/result`、`GET source/download`，前缀 `/api/excalidraw-export/`。
- 编辑 JSON 响应统一 `{ok:true,value}` 或 `{ok:false,error:{code,message,currentVersion?}}`。
- 接口鉴权绑定 owner Peer、精确 Session、当前连接/请求 token；不得给 API/viewer Peer 浏览器编辑权限。取消、卸载清理连接、任务、监听和等待者；不能在源图仍有脏稿时悄悄销毁它。
- 自动打开请求从成功的 `excalidraw_preview` Session tool result 派生；前台 Session 才打开，不添加手动 composer 绘图表单。

## 6. 环境与装配

- DSH Web/Cordis：以 `0.2.2-alpha.2` 为兼容基准，使用既有 GUI；Bun 开发/测试，Host 构建目标 Node 22。
- 运行依赖：`zod@4.1.12`；官方库 `@excalidraw/excalidraw@0.18.0`。
- 构建依赖：`esbuild@0.25.12`、`postcss@8.5.6`、`postcss-selector-parser@7.1.0`；DOM 测试可用 `happy-dom@21.0.4`。
- 共享宿主 `react`、`react-dom`、`react/jsx-runtime`，不引入第二份 React，不从 CDN 运行画布。内嵌官方234个字体文件，覆盖中文。

空项目按 **源码 / 构建产物 / 测试** 分开组织，提供 `build:canvas`、`build:host`、`test` 三个脚本：

```text
package.json / cordis.patch.yml
src/     Host注册、入口、场景工具、协作协调、导出、Client factory
lib/     构建后的Host、Client、官方canvas chunk及许可资源
locale/  en.json、zh.json（meta.title、meta.description）
icon.svg
build-host.ts / build-library.ts / canvas-entry.js
tests/   单元、Host/Client往返与布局交互回归
```

包名 `@local/dsh-excalidraw-preview`；运行导出包括 Host 入口、`./client`、`./locale/*.json`、`./icon`；`files` 必须覆盖所有发布资源。动态 Client factory 的模块 ID 与包名一致。

包清单骨架（`lib/host.js`为复刻项目约定的构建输出）：

```json
{
  "name": "@local/dsh-excalidraw-preview",
  "version": "0.3.9",
  "private": true,
  "type": "module",
  "engines": { "dsh": "0.2.2-alpha.2" },
  "exports": {
    ".": "./lib/host.js",
    "./client": "./lib/client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg"
  },
  "files": ["lib", "locale", "icon.svg", "cordis.patch.yml"],
  "dependencies": { "zod": "4.1.12" },
  "devDependencies": {
    "@excalidraw/excalidraw": "0.18.0",
    "esbuild": "0.25.12",
    "postcss": "8.5.6",
    "postcss-selector-parser": "7.1.0",
    "happy-dom": "21.0.4"
  },
  "scripts": {
    "test": "bun test",
    "build:canvas": "bun build-library.ts",
    "build:host": "bun build-host.ts"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": [
        "@deepseek-ai/dsh-client-ui-sidebar-documentpreview",
        "@deepseek-ai/dsh-client-ui-conversation",
        "@deepseek-ai/dsh-client-ui-session",
        "@deepseek-ai/dsh-client-locale",
        "@deepseek-ai/dsh-client-connection",
        "@deepseek-ai/dsh-api-remotes"
      ]
    }
  }
}
```

```yaml
# cordis.patch.yml
- insert:
    - id: excalidraw-preview
      name: '@local/dsh-excalidraw-preview'
      config: {}
```

从空目录实现上述模块后：安装依赖（不擅自运行安装脚本）→ 构建官方运行库与 Host → 跑测试、语法及包资源检查 → 通过 DSH `plugin_manager install_bundle` 安装绝对包目录。安装影响整个 profile，须明确授权；以 applied/warnings/nextStep 判定生效。Client 变化刷新既有页面核对，不靠新起服务替代。

## 7. 固定上限与验收

| 项目 | 要求 |
| --- | --- |
| 文档/导出 | 最大32 MiB；源文件落盘字节包含 newline；最多50,000元素。 |
| patch/读取 | patch最多200元素；摘要最多200元素/页，默认50；输出提供真实截断标记。 |
| 草稿恢复 | 最大2 MiB，按UTF-16存储估算。 |
| flush/事务 | flush最长10秒；跨调用事务最长120秒。 |
| PNG分配 | 总像素≤16,777,216；单边≤16,384。 |
| 用户diff | 最多100项变化、约32 KiB；超出明确截断，不包含图片字节。 |

复刻验收只需证明以下全部成立：

1. `/excalidraw` 一句话创建中文图，在既有右侧打开；不调用 CLI、普通文件写入或新增服务器。
2. 重复和竞争创建均不覆盖；权限拒绝、取消和路径身份变化可解释。
3. 用户拖动、改字、增删并自动保存；鼠标准确，视口操作不改源文件。
4. 立即发消息或 Agent begin，最后一笔用户草稿先 flush；局部 patch 保留其他 raw 内容，旧版本提交失败。
5. working 全程只读，idle/事务结束按正确条件恢复；其他 Session 普通工具不受影响。
6. 冲突、断线、刷新及存储失败不冒充保存成功，草稿可保留/下载。
7. 官方 PNG/SVG 对应同一已提交源版本，包含全图和中文；回到编辑后不撤销 Agent 修改。
8. 自动测试覆盖上述权限、竞态、数据保留、状态机与布局输入；再实际手验，不能用测试或安装成功替代 GUI 验收。

**范围边界**：不包含高层自动布局、多人实时合编、在线分享、任意外部进程的强原子CAS或hardlink身份统一。普通文件工具和外部进程不参与插件的草稿flush及协作锁。
