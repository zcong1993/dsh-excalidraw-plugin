# Excalidraw for DeepSeek Harness

[![CI](https://github.com/zcong1993/dsh-excalidraw-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/zcong1993/dsh-excalidraw-plugin/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/zcong1993/dsh-excalidraw-plugin/branch/main/graph/badge.svg)](https://codecov.io/gh/zcong1993/dsh-excalidraw-plugin)
[![npm](https://img.shields.io/npm/v/@zcong/dsh-excalidraw-plugin)](https://www.npmjs.com/package/@zcong/dsh-excalidraw-plugin)
[![License: MIT](https://img.shields.io/github/license/zcong1993/dsh-excalidraw-plugin)](LICENSE)
![DSH](https://img.shields.io/badge/DSH-0.2.1--rc.5-blue)

在 DeepSeek Harness 的右侧边栏使用官方 Excalidraw 画布：让 Agent 用自然语言画图，你在同一张画布上继续修改，最后导出 PNG / SVG。

图形保存在工作区里真实的 `.excalidraw` 文件上，Agent 和你编辑的是同一个源文件。

## 特性

- 一句话生成可编辑图表，之后可以继续让 Agent 修改
- 官方 Excalidraw 0.18 编辑器，内置字体（含中文），离线可用
- 自动保存、草稿恢复、版本冲突保护；Agent 处理时画布自动只读
- 工具栏直接导出 PNG / SVG，或让 Agent 导出为会话附件
- 不修改 DSH 本体，不启动额外服务，不新增端口

## 环境要求

- DSH `0.2.1-rc.5`
- 插件安装在当前 profile 中

## 安装

```text
plugin_manager install_bundle @zcong/dsh-excalidraw-plugin@0.3.9
```

也可以在 profile 的 `package.json` 中加入依赖并启用：

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

安装后 `excalidraw` skill 会由插件自动注册，不需要复制文件；插件不再注册 `/excalidraw` 命令。

## 快速开始

直接对 Agent 说：

```text
画一个用户 → 网关 → 服务 → 数据库的架构图
把当前图里的节点统一尺寸，保留我调整过的位置
把这张图导出成 PNG
```

Agent 会创建或修改 `.excalidraw` 文件并在右侧打开画布，之后你可以在画布上直接编辑。

## 画布操作

| 控件 | 作用 |
| --- | --- |
| 编辑 / 完成编辑 | 进入或退出编辑；Agent 处理期间不可用 |
| 重新加载 | 重新读取源文件 |
| 缩放 − / 比例 / + | 以视口中心放大或缩小；可与滚轮缩放混用 |
| 适应屏幕 | 把整张图放进视口，不修改图形本身 |
| 导出 | PNG 2× / PNG 3× / SVG，下载当前画面 |

编辑时自动保存（500 ms 防抖）；未保存内容会作为草稿保留，检测到外部修改时会停止自动保存并提示下载草稿或加载最新。

## 常见问题

**Agent 已经空闲，画布仍显示「Agent 正在处理」？**
说明连接已失效，客户端会自动重连；仍未恢复时刷新页面（桌面客户端可完全退出后重开）。

**更新插件后界面没有变化？**
桌面客户端不会热重载前端 bundle，需要完全退出客户端再打开。

**支持哪些文件？**
扩展名为 `.excalidraw`、内容为合法 Excalidraw JSON 的普通文件；符号链接会被拒绝。

## 文档

- [开发规范](docs/DEVELOPMENT.md)：架构、工具与 HTTP 契约、技能约定、构建与测试、运行限制
- [原始规格](docs/spec.md)

## 许可证

[MIT](LICENSE)。内置的 Excalidraw 运行时遵循其自身许可，声明见 `lib/assets/LICENSE-excalidraw` 与 `lib/assets/THIRD_PARTY_NOTICES.md`。
