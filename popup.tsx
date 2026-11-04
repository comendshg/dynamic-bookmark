import { useEffect, useMemo, useState } from "react"

import {
  buildFolderPathsById,
  findFolderNodesByIds,
  getExtensionEnabled,
  getManagedFolderIds,
  getOperationLogs,
  setExtensionEnabled,
  type BookmarkUrlSnapshot,
  type OperationLogEntry
} from "./logger"

// popup 顶部「最近更新」最多展示条数
const MAX_RECENT_UPDATES = 3

type ManagedFolderView = {
  id: string
  title: string
  path: string
}

function openExtensionPage(page: string) {
  void chrome.tabs.create({ url: chrome.runtime.getURL(page) })
}

// 从操作日志中提取最近成功的书签更新（最新的在前）。
function pickRecentUpdates(logs: OperationLogEntry[]): OperationLogEntry[] {
  return logs
    .filter(
      (entry) =>
        entry.operationType === "bookmark-url-update" &&
        !entry.error &&
        entry.after.snapshotType === "bookmark-url"
    )
    .slice(-MAX_RECENT_UPDATES)
    .reverse()
}

function formatRelativeTime(timestamp: number): string {
  const diffMinutes = Math.floor((Date.now() - timestamp) / 60000)

  if (diffMinutes < 1) {
    return "刚刚"
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`
  }

  const diffHours = Math.floor(diffMinutes / 60)

  if (diffHours < 24) {
    return `${diffHours} 小时前`
  }

  return `${Math.floor(diffHours / 24)} 天前`
}

// 总开关：ON = 正常维护书签；OFF = 暂停，后台不写书签也不写日志。
function EnabledSwitch(props: { enabled: boolean; isBusy: boolean; onToggle: (next: boolean) => void }) {
  const { enabled, isBusy, onToggle } = props

  return (
    <button
      role="switch"
      aria-checked={enabled}
      disabled={isBusy}
      onClick={() => onToggle(!enabled)}
      title={enabled ? "点击暂停：暂停后不再自动更新书签" : "点击开启：恢复自动更新书签"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 4px 4px 10px",
        borderRadius: 999,
        border: `1px solid ${enabled ? "rgba(94, 234, 212, 0.30)" : "rgba(148, 163, 184, 0.25)"}`,
        background: enabled ? "rgba(94, 234, 212, 0.10)" : "rgba(148, 163, 184, 0.10)",
        cursor: isBusy ? "wait" : "pointer",
        flexShrink: 0
      }}>
      <span style={{ fontSize: 11.5, fontWeight: 500, color: enabled ? "#5EEAD4" : "#94A3B8" }}>
        {isBusy ? "切换中" : enabled ? "已开启" : "已暂停"}
      </span>
      <span
        style={{
          position: "relative",
          width: 34,
          height: 19,
          borderRadius: 999,
          background: enabled ? "#14B8A6" : "rgba(148, 163, 184, 0.35)",
          transition: "background 0.15s ease",
          flexShrink: 0
        }}>
        <span
          style={{
            position: "absolute",
            top: 2.5,
            left: enabled ? 17.5 : 2.5,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: enabled ? "#0B0D12" : "#E2E8F0",
            transition: "left 0.15s ease"
          }}
        />
      </span>
    </button>
  )
}

// 最近更新单行：书签名 + 新地址摘要 + 一键撤销。
function RecentUpdateRow(props: {
  entry: OperationLogEntry
  snapshot: BookmarkUrlSnapshot
  isUndoing: boolean
  anyUndoing: boolean
  onUndo: (entry: OperationLogEntry) => void
}) {
  const { snapshot, isUndoing, anyUndoing, onUndo, entry } = props

  const rawUrl = snapshot.bookmarkUrl ?? ""
  let urlSummary = rawUrl

  try {
    const parsed = new URL(rawUrl)
    const segments = parsed.pathname.split("/").filter(Boolean)
    const lastSegment = segments[segments.length - 1]
    urlSummary = lastSegment
      ? `${parsed.hostname}/…/${lastSegment}${parsed.search ? parsed.search.slice(0, 10) + "…" : ""}`
      : parsed.hostname
  } catch {
    // 解析失败就原样截断
  }

  if (urlSummary.length > 44) {
    urlSummary = urlSummary.slice(0, 43) + "…"
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 9px",
        borderRadius: 9,
        background: "rgba(94, 234, 212, 0.05)",
        border: "1px solid rgba(94, 234, 212, 0.14)",
        borderLeft: "2.5px solid #2DD4BF"
      }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: "#F1F5F9",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>
            {snapshot.bookmarkTitle}
          </span>
          <span style={{ flexShrink: 0, fontSize: 10.5, color: "#64748B" }}>
            {formatRelativeTime(entry.timestamp)}
          </span>
        </div>
        <div
          title={snapshot.bookmarkUrl ?? undefined}
          style={{
            marginTop: 1,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 10.5,
            color: "#7DD3C8",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}>
          → {urlSummary || "（无 URL）"}
        </div>
      </div>

      <button
        disabled={anyUndoing}
        onClick={() => onUndo(entry)}
        title="把这本书签恢复到本次更新之前的地址"
        style={{
          flexShrink: 0,
          border: "1px solid rgba(94, 234, 212, 0.30)",
          borderRadius: 7,
          padding: "5px 9px",
          background: isUndoing ? "rgba(94, 234, 212, 0.25)" : "rgba(94, 234, 212, 0.10)",
          color: "#5EEAD4",
          fontSize: 11.5,
          fontWeight: 500,
          cursor: anyUndoing ? "not-allowed" : "pointer",
          opacity: isUndoing ? 0.8 : 1,
          whiteSpace: "nowrap"
        }}>
        {isUndoing ? "撤销中" : "撤销"}
      </button>
    </div>
  )
}

function IndexPopup() {
  const [enabled, setEnabled] = useState(true)
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false)
  const [managedFolders, setManagedFolders] = useState<ManagedFolderView[]>([])
  const [recentUpdates, setRecentUpdates] = useState<OperationLogEntry[]>([])
  const [undoingKey, setUndoingKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [statusMessage, setStatusMessage] = useState("")
  const [statusTone, setStatusTone] = useState<"info" | "error">("info")

  useEffect(() => {
    let isActive = true

    async function loadPopupData() {
      try {
        const [enabledState, folderIds, operationLogs] = await Promise.all([
          getExtensionEnabled(),
          getManagedFolderIds(),
          getOperationLogs()
        ])

        // 配置里存的是文件夹 id，展示时换算成名称与路径（也不受改名影响）。
        const [folderNodes, pathsById] = await Promise.all([
          findFolderNodesByIds(folderIds),
          buildFolderPathsById()
        ])

        const folders: ManagedFolderView[] = folderNodes.map((node) => ({
          id: node.id,
          title: node.title,
          path: pathsById.get(node.id) ?? node.title
        }))

        if (!isActive) return

        setEnabled(enabledState)
        setManagedFolders(folders)
        setRecentUpdates(pickRecentUpdates(operationLogs))
      } catch (error) {
        if (!isActive) {
          return
        }

        setStatusTone("error")
        setStatusMessage("加载失败，请重新打开弹窗。")
        console.error("[Dynamic Bookmark] Failed to load popup data:", error)
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadPopupData()

    return () => {
      isActive = false
    }
  }, [])

  async function toggleEnabled(next: boolean) {
    setIsTogglingEnabled(true)
    const previous = enabled

    // 先乐观更新，让开关即时响应
    setEnabled(next)

    try {
      await setExtensionEnabled(next)
      setStatusTone("info")
      setStatusMessage(next ? "已开启，正在维护托管书签" : "已暂停，不会更新任何书签")
    } catch (error) {
      setEnabled(previous)
      setStatusTone("error")
      setStatusMessage("开关保存失败，请重试。")
      console.error("[Dynamic Bookmark] Failed to toggle extension:", error)
    } finally {
      setIsTogglingEnabled(false)
    }
  }

  // 一键撤销：把书签恢复到这条记录变更之前的地址。
  async function undoRecentUpdate(entry: OperationLogEntry) {
    const key = `${entry.timestamp}-${entry.after.snapshotType === "bookmark-url" ? entry.after.bookmarkId : ""}`
    const title = entry.after.snapshotType === "bookmark-url" ? entry.after.bookmarkTitle : "书签"

    setUndoingKey(key)

    try {
      const response = await chrome.runtime.sendMessage({
        type: "rollback-operation-log",
        entry
      })

      if (!response?.ok) {
        throw new Error(response?.message ?? "回退失败")
      }

      setStatusTone("info")
      setStatusMessage(`已撤销「${title}」的最近更新`)
      // 撤销成功后把这行移除：它已不代表当前状态，完整历史仍在日志页
      setRecentUpdates((current) =>
        current.filter((item) => {
          if (item.after.snapshotType !== "bookmark-url") {
            return true
          }

          return `${item.timestamp}-${item.after.bookmarkId}` !== key
        })
      )
    } catch (error) {
      setStatusTone("error")
      setStatusMessage("撤销失败：书签可能已被删除，或后台为旧版本。")
      console.error("[Dynamic Bookmark] Failed to undo recent update:", error)
    } finally {
      setUndoingKey(null)
    }
  }

  const folderSummary = useMemo(() => {
    if (managedFolders.length === 0) {
      return "尚未选择"
    }

    return `已接管 ${managedFolders.length} 个`
  }, [managedFolders])

  return (
    <div
      style={{
        boxSizing: "border-box",
        height: 480,
        padding: 14,
        width: 360,
        background: "#12141A",
        color: "#F8FAFC",
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
        display: "flex",
        flexDirection: "column",
        overflow: "hidden"
      }}>
      <style>
        {`
          html, body {
            margin: 0;
            padding: 0;
            background: #12141A;
            overflow: hidden;
          }
          ::-webkit-scrollbar { width: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
        `}
      </style>

      {/* 头部：品牌 + 总开关 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m19 21 7-7-4-4-7 7-1.5 5.5L19 21z" />
          <path d="m6.5 10.5 4 4" transform="translate(-1,0)" />
          <path d="M21.74 12.42 12.42 21.74a2 2 0 0 1-2.83 0L2 14.25V2h12.25l7.49 8.59a2 2 0 0 1 0 2.83z" transform="scale(0.85) translate(2,1)" />
        </svg>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.2, flex: 1 }}>Dynamic Bookmark</div>
        <EnabledSwitch enabled={enabled} isBusy={isTogglingEnabled} onToggle={(next) => void toggleEnabled(next)} />
      </div>

      <div style={{ marginTop: 5, marginBottom: 12, fontSize: 11.5, lineHeight: 1.5, color: "#64748B", flexShrink: 0 }}>
        {enabled ? "关闭标签页时，自动把托管书签更新到最近的位置。" : "已暂停：浏览行为不会被记录，书签也不会被修改。"}
      </div>

      {/* 已接管文件夹：只展示，不在这里选 */}
      <div
        style={{
          flexShrink: 0,
          borderRadius: 11,
          border: "1px solid rgba(255, 255, 255, 0.06)",
          background: "rgba(255, 255, 255, 0.02)",
          padding: "9px 10px"
        }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
          <span style={{ fontSize: 11, letterSpacing: 0.3, color: "#64748B" }}>
            已接管文件夹 · {isLoading ? "加载中" : folderSummary}
          </span>
          <button
            onClick={() => openExtensionPage("tabs/settings.html")}
            style={{
              background: "transparent",
              border: "none",
              padding: 0,
              fontSize: 11,
              color: "#5EEAD4",
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 2
            }}>
            管理
          </button>
        </div>

        {managedFolders.length === 0 ? (
          <button
            onClick={() => openExtensionPage("tabs/settings.html")}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "9px 10px",
              borderRadius: 8,
              border: "1px dashed rgba(94, 234, 212, 0.28)",
              background: "rgba(94, 234, 212, 0.04)",
              color: "#5EEAD4",
              fontSize: 12,
              cursor: "pointer"
            }}>
            + 选择要接管的文件夹
          </button>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 58, overflowY: "auto" }}>
            {managedFolders.map((folder) => (
              <span
                key={folder.id}
                title={folder.path}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11.5,
                  padding: "3px 9px",
                  borderRadius: 999,
                  background: "rgba(94, 234, 212, 0.09)",
                  border: "1px solid rgba(94, 234, 212, 0.22)",
                  color: "#5EEAD4",
                  maxWidth: "100%"
                }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                </svg>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.title}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 最近更新：可见 + 可撤销 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "13px 0 7px", flexShrink: 0 }}>
        <span style={{ fontSize: 11, letterSpacing: 0.3, color: "#64748B" }}>最近更新</span>
        <button
          onClick={() => openExtensionPage("tabs/log.html")}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            fontSize: 11,
            color: "#64748B",
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: 2
          }}>
          查看全部
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {recentUpdates.length === 0 ? (
          <div
            style={{
              padding: "22px 12px",
              textAlign: "center",
              fontSize: 12,
              lineHeight: 1.7,
              color: "#64748B",
              border: "1px dashed rgba(255, 255, 255, 0.08)",
              borderRadius: 10
            }}>
            {isLoading ? "正在加载..." : "还没有书签更新记录。\n关掉一个正在看的课程/视频标签页试试。"}
          </div>
        ) : (
          recentUpdates.map((entry) => {
            if (entry.after.snapshotType !== "bookmark-url") {
              return null
            }

            const key = `${entry.timestamp}-${entry.after.bookmarkId}`

            return (
              <RecentUpdateRow
                key={key}
                entry={entry}
                snapshot={entry.after}
                isUndoing={undoingKey === key}
                anyUndoing={undoingKey !== null}
                onUndo={(target) => void undoRecentUpdate(target)}
              />
            )
          })
        )}
      </div>

      {/* 底部：状态 + 页面入口 */}
      <div
        style={{
          flexShrink: 0,
          margin: "10px -14px 0",
          padding: "10px 14px 0",
          borderTop: "1px solid rgba(255, 255, 255, 0.07)",
          background: "#12141A",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8
        }}>
        <div style={{ minWidth: 0, fontSize: 11, lineHeight: 1.4, color: statusTone === "error" ? "#FCA5A5" : "#5EEAD4" }}>
          {statusMessage}
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => openExtensionPage("tabs/settings.html")}
            style={{
              border: "1px solid rgba(255, 255, 255, 0.10)",
              borderRadius: 8,
              padding: "8px 13px",
              background: "rgba(255, 255, 255, 0.04)",
              color: "#F8FAFC",
              fontSize: 12.5,
              cursor: "pointer",
              whiteSpace: "nowrap"
            }}>
            设置
          </button>
          <button
            onClick={() => openExtensionPage("tabs/log.html")}
            style={{
              border: "1px solid rgba(255, 255, 255, 0.10)",
              borderRadius: 8,
              padding: "8px 13px",
              background: "rgba(255, 255, 255, 0.04)",
              color: "#F8FAFC",
              fontSize: 12.5,
              cursor: "pointer",
              whiteSpace: "nowrap"
            }}>
            日志
          </button>
        </div>
      </div>
    </div>
  )
}

export default IndexPopup
