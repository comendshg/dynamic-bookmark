# Dynamic Bookmark

一个用于动态更新书签 URL 的浏览器扩展，基于 Plasmo 构建。扩展会在标签页关闭时尝试将最近访问的页面地址覆盖回对应的书签，以便书签总是指向最新的阅读/观看位置。

---

## 主要特性

- 在指定的书签文件夹中查找并更新书签的 URL。
- 支持针对 B 站视频的 BV 号匹配以及文档/课程类网站的“域名 + 第一级路径”前缀匹配。
- 仅更新书签的 URL；不会修改书签的标题（title/name），从而避免意外覆盖用户自定义的书签名。
- 总开关：可随时暂停/恢复，暂停期间不写书签、不记日志。
- 最近更新可见、可撤销：主页展示最近的更新记录，一键恢复到更新前的地址。
- 日志页支持「时间线」与「按书签」两种视图，后者可回退到某本书签的任意历史版本。

---

## 界面结构

| 入口 | 文件 | 职责 |
| --- | --- | --- |
| 主界面（popup） | [popup.tsx](popup.tsx) | 总开关；主题快捷切换；运行状态条；已接管文件夹的展示与入口；最近更新（旧地址 → 新地址 diff）与一键撤销；管理页入口 |
| 管理页 | [tabs/manage.tsx](tabs/manage.tsx) | 侧栏导航的整页工具：概览（状态与统计）、托管文件夹（面包屑下钻、搜索、勾选即保存）、操作日志（时间线 / 按书签双视图、回退、清空）、外观与通用（主题三态） |
| 主题系统 | [theme.ts](theme.ts) | `themePreference`（auto/light/dark）存储与跨页面实时同步；跟随系统 `prefers-color-scheme` |
| UI 设计系统 | [styles/ui.css](styles/ui.css)、[ui/](ui) | 设计 tokens（CSS 变量）与共用组件、图标 |
| 后台 | [background.ts](background.ts) | 标签页跟踪、匹配与书签更新、配置迁移、消息协议 |
| 通用工具 | [logger.ts](logger.ts)、[historyRollback.ts](historyRollback.ts) | 存储与日志读写、文件夹查找、回退执行 |

“选择文件夹”是一次性配置，因此不占用主界面，放在管理页的「托管文件夹」区（通过 `tabs/manage.html#folders` 打开）；主界面只承担日常高频操作（看状态、做撤销）。设置页与日志页已合并为一个管理页，不再有独立的 `tabs/settings.html` / `tabs/log.html`。

亮 / 暗主题：偏好（`themePreference`：`auto` / `light` / `dark`）保存在 `chrome.storage.local`；`auto` 跟随系统并实时响应系统切换；弹窗与管理页通过 `storage.onChanged` 即时同步换肤。弹窗顶栏提供亮暗快捷切换，管理页侧栏与「外观与通用」区提供三态完整控件。

---

## 目录

- 项目代码：[background.ts](background.ts)、[popup.tsx](popup.tsx)、[theme.ts](theme.ts)
- 管理页源码：[tabs/manage.tsx](tabs/manage.tsx)
- UI 组件与设计系统：[ui/](ui)（icons / common / folders / logs / overview / appearance）、[styles/ui.css](styles/ui.css)
- 通用工具：[logger.ts](logger.ts)、[historyRollback.ts](historyRollback.ts)
- 构建产物：`build/`（包含 `chrome-mv3-dev`、`chrome-mv3-prod` 等子目录）。注意 `build/` 已被 `.gitignore` 忽略，克隆仓库后需要先执行 `npm run build`（或 `npm run dev`）自行生成。

---

## 快速开始（开发）

1. 安装依赖并启动开发服务：

```bash
pnpm dev
# or
npm run dev
```

2. 在浏览器中加载开发构建目录，例如：`build/chrome-mv3-dev`。

3. 修改源码（如 `popup.tsx` 或 `background.ts`），按需重建或使用开发模式热加载。

---

## 使用说明

- 首次使用：打开主界面 → 「选择要接管的文件夹」（或点「管理」）→ 在管理页勾选要接管的收藏夹。勾选即生效，无需保存。
- 主界面顶部的开关控制插件是否工作：暂停后不写书签、不记日志；已接管文件夹与最近更新仍可查看。
- 扩展会监听标签页的 URL / title 变化，并在你离开当前学习页、切换到其他网页时提前触发匹配逻辑；标签页关闭仍然作为兜底。
- 匹配时先尝试精确（去 hash 后）匹配书签 URL，找不到则按匹配规则回退匹配。
- 如果找到目标书签，扩展会调用 `chrome.bookmarks.update` 将书签的 `url` 更新为最近访问的地址；扩展不会更改原有的书签 `title`。
- 所有书签 URL 更新和配置变更都会写入 `chrome.storage.local` 日志，日志页面可查看并按单条历史记录回退；主界面的「最近更新」也可直接撤销最近一次改动。

匹配规则简要说明：

- B 站视频：以 `/video/BV...` 中的 BV 号为关键匹配键。
- 文档/课程类站点：以 `origin + 第一级路径/` 作为课程前缀进行聚合匹配。

---

## 配置

- 托管配置以**书签文件夹 id** 的形式存储在 `chrome.storage.local`（键 `managedFolderIds`），文件夹改名或移动都不会导致接管失效；旧版本以路径字符串保存的配置（键 `managedFolderTitles`）会在后台启动时自动迁移为 id。
- 修改方式：管理页「托管文件夹」区（`tabs/manage.html#folders`）勾选即可；开发者也可以通过 runtime 消息 `set-managed-folders` 携带 `folderIds` 数组修改（兼容旧字段 `folderTitles`）。
- 总开关存储在 `dynamicBookmarkEnabled`（默认 `true`）；关闭后后台在提交阶段直接跳过，不写书签也不写日志。
- 主题偏好存储在 `themePreference`（默认 `auto`）；详见上文「亮 / 暗主题」。
- 日志与回退入口：主界面与管理页均可打开，管理页「操作日志」区内可执行「清空全部日志」、按记录回退，或切到「按书签」回退到任意历史版本。

源码位置：主要逻辑在 [background.ts](background.ts)。

---

## 贡献

欢迎通过 Issue 或 PR 提交改进建议。提交 PR 前请确保本地构建通过并在描述中说明变更目的。

---
