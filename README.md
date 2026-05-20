# Dynamic Bookmark

一个用于动态更新书签 URL 的浏览器扩展，基于 Plasmo 构建。扩展会在标签页关闭时尝试将最近访问的页面地址覆盖回对应的书签，以便书签总是指向最新的阅读/观看位置。

---

## 主要特性

- 在指定的书签文件夹中查找并更新书签的 URL。
- 支持针对 B 站视频的 BV 号匹配以及文档/课程类网站的“域名 + 第一级路径”前缀匹配。
- 仅更新书签的 URL；不会修改书签的标题（title/name），从而避免意外覆盖用户自定义的书签名。

---

## 目录

- 项目代码：[background.ts](background.ts)、[popup.tsx](popup.tsx)
- 构建产物：`build/`（包含 `chrome-mv3-dev`、`chrome-mv3-prod` 等子目录）

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

- 扩展会监听标签页的 URL / title 变化并在标签页关闭时触发匹配逻辑：先尝试精确（去 hash 后）匹配书签 URL，找不到则按匹配规则回退匹配。
- 如果找到目标书签，扩展会调用 `chrome.bookmarks.update` 将书签的 `url` 更新为最近访问的地址；扩展不会更改原有的书签 `title`。

匹配规则简要说明：

- B 站视频：以 `/video/BV...` 中的 BV 号为关键匹配键。
- 文档/课程类站点：以 `origin + 第一级路径/` 作为课程前缀进行聚合匹配。

---

## 配置

- 被管理的书签文件夹名称列表会被持久化存储（local storage），扩展仅对这些文件夹下的书签进行监控与覆盖更新。
- 修改方式：如果扩展包含设置界面，请在该界面中添加或移除文件夹名称；开发者或高级用户可以通过向扩展发送 runtime 消息 `set-managed-folders` 并携带 `folderTitles` 数组来修改该列表（详见源码）。

源码位置：主要逻辑在 [background.ts](background.ts)。

---

## 贡献

欢迎通过 Issue 或 PR 提交改进建议。提交 PR 前请确保本地构建通过并在描述中说明变更目的。

---
