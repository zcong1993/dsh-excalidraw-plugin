# AGENTS.md

本文件面向在本仓库工作的编码 Agent。完整工程契约见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)；两者冲突时以 `DEVELOPMENT.md` 与代码为准，并同步修正。

## 项目

DSH（DeepSeek Harness）的独立 Cordis 插件：在右侧边栏提供官方 Excalidraw 画布，`excalidraw` skill 驱动自然语言绘图，图形保存为工作区里的 `.excalidraw` 文件。npm 包名 `@zcong/dsh-excalidraw-plugin`。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/host/` | 工具、命令、HTTP 路由、事务/flush、导出校验 |
| `src/client/` | 画布、自动保存、草稿、冲突、导出 worker |
| `src/host/document.js` | 纯文档契约（校验/摘要/patch/diff），不得访问 `ctx` 或文件系统 |
| `.dsh/skills/excalidraw/SKILL.md` | 自然语言入口（构建时内联并由 Host 运行时注册） |
| `build-host.ts` / `build-library.ts` | 构建脚本；`bun run build` 先 canvas 后 host |
| `lib/` | 构建产物，**不提交** |

## 命令

```bash
pnpm install          # pnpm 11，与 DSH profile 一致
bun run build         # build:canvas → build:host
bun test              # Bun 测试
pnpm exec tsc --noEmit # 构建脚本类型检查
pnpm publish --dry-run
```

改动 Client 后必须刷新页面（桌面客户端需完全退出重开）；仅重载 Host 不会替换浏览器 bundle。

## 必须遵守的不变量

**文件与版本**
- 所有工作区读写走 `ctx.fs` + `sandboxPolicy`，禁止用 Node `fs` 绕过授权。
- 只接受普通 `.excalidraw` 文件；拒绝符号链接；创建用 `createIfAbsent`，写入用 `replaceIfVersion`。
- 事务：`begin` 锁定 120 秒，`update` 必须带 `expectedVersion`；过期直接 `VERSION_CONFLICT`，**不自动重试**。
- 同一文件同时只允许一个事务；Agent working 时画布只读。

**Flush**
- Client 约 900 ms 轮询；Host flush 上限 10 秒；连接 5 秒无 poll 视为 stale。
- 同一 `opId` 幂等，重试必须复用同一 body；强 flush 只针对 live 连接。

**导出**
- 必须由已连接的 owner 页面调用官方 `exportToBlob` / `exportToSvg`，Host 只校验与保存。
- PNG ≤ 16,777,216 像素、单边 ≤ 16,384；SVG 拒绝脚本、事件属性、`foreignObject`、`javascript:` 与远程资源。
- 先保存 attachment 再报告成功；用户未明确要求时不要主动导出，导出状态数秒后消失。

**Client 状态机**
- 初始只读；“完成编辑”必须先提交再退出。
- 自动保存 500 ms 防抖、串行提交；`appStatePatch` 排除 viewport / selection / editingElement。
- 草稿放 `sessionStorage`（2 MiB 上限）；冲突时停止自动保存，不得静默丢弃草稿。
- 预览必须聚焦已有 tab，禁止 `{ revealIfOpened: false }`。

**Skill**
- Skill 位于 `.dsh/skills/excalidraw/SKILL.md`，`user-invocable: true`；Host 用 `ctx.skills.register()` 注册内联副本，项目级同名 skill 优先。
- 插件不注册 `/excalidraw` 命令，只保留 `/excalidraw-scene`、`/excalidraw-export` 两个诊断命令。

**资源**
- Excalidraw 构建为独立 lazy chunk；React 走页面共享模块表，禁止第二份 React。
- 官方 CSS 用 PostCSS 加 `.dsh-excalidraw-plugin` 前缀；字体与 locale 全部随包，禁止 CDN。

## 代码风格

- ESM、2 空格缩进、单引号、无分号；沿用现有文件命名与分层。
- 错误使用稳定 code + 可操作的 message；不要吞错或返回模糊失败。
- 工具输出必须是 lossless JSON，`presentationMeta` 不含 `undefined`（可选字段用条件展开）。
- 注释解释“为什么”，不复述代码。

## 验证清单

- [ ] `bun test` 全绿，新增行为有测试或手验记录。
- [ ] `bun run build` 成功；`node --check lib/host.js lib/client.js lib/assets/canvas.js` 通过。
- [ ] `pnpm exec tsc --noEmit` 通过。
- [ ] 插件安装返回 `applied` 且 `warnings` 为空。
- [ ] 实际打开画布：中文可见、拖动/改字自动保存、冲突不丢草稿、PNG/SVG 与源版本一致。
- [ ] 未提交 `lib/`、临时画布、截图或调试文件。

## 文档

- `README.md`：使用者文档，只写安装/使用/FAQ；不要往里堆开发细节。
- `docs/DEVELOPMENT.md`：工程契约与实现细节，是技术事实的来源。
- `docs/spec.md`：历史功能规格，保留原文。

## 提交

- 使用 conventional commits（英文，如 `fix: ...`、`docs: ...`），一次提交只做一件事。
- 改权限、版本语义、flush 或导出安全时，同一提交内同步更新 `docs/DEVELOPMENT.md`。
