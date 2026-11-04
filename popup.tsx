import { useEffect, useMemo, useState } from "react"

import uiCss from "data-text:./styles/ui.css"

import { useTheme } from "./theme"
import { ToastHost, useToast, Switch } from "./ui/common"
import { formatRelativeTime, shortenUrl } from "./ui/format"
import { BrandIcon, ChevronRightIcon, FolderIcon, MoonIcon, SunIcon, UndoIcon } from "./ui/icons"
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

function openManagePage(section: "overview" | "folders" | "logs" | "appearance") {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`tabs/manage.html#${section}`) })
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

/* ------------------------------------------------------------
   最近更新单行：书签名 + 旧→新地址 diff + 一键撤销
   ------------------------------------------------------------ */

function RecentUpdateRow(props: {
  entry: OperationLogEntry
  snapshot: BookmarkUrlSnapshot
  isUndoing: boolean
  anyUndoing: boolean
  isLeaving: boolean
  onUndo: (entry: OperationLogEntry) => void
}) {
  const { snapshot, isUndoing, anyUndoing, isLeaving, onUndo, entry } = props

  const afterUrl = shortenUrl(snapshot.bookmarkUrl)
  const beforeUrl =
    entry.before.snapshotType === "bookmark-url" ? shortenUrl(entry.before.bookmarkUrl, 32) : null

  return (
    <div className={`db-row${isUndoing || isLeaving ? " is-busy" : ""}${isLeaving ? " is-leaving" : ""}`} style={{ alignItems: "flex-start" }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 500,
              color: "var(--t1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>
            {snapshot.bookmarkTitle}
          </span>
          <span style={{ flexShrink: 0, fontSize: 10.5, color: "var(--t3)" }}>
            {formatRelativeTime(entry.timestamp)}
          </span>
        </div>

        <div
          title={`${entry.before.snapshotType === "bookmark-url" ? entry.before.bookmarkUrl : ""}\n→ ${snapshot.bookmarkUrl ?? ""}`}
          className="mono"
          style={{
            marginTop: 3,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: "var(--t3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>
          {beforeUrl && (
            <span style={{ textDecoration: "line-through" }}>{beforeUrl}</span>
          )}
          <span style={{ color: "var(--accent)", margin: beforeUrl ? "0 4px" : "0 2px 0 0" }}>→</span>
          <span style={{ color: "var(--t2)" }}>{afterUrl || "（无 URL）"}</span>
        </div>
      </div>

      <button
        type="button"
        className="db-btn db-btn-sm db-btn-ghost"
        disabled={anyUndoing}
        onClick={() => onUndo(entry)}
        title="把这本书签恢复到本次更新之前的地址"
        style={{ marginTop: 2 }}>
        {isUndoing ? <UndoIcon size={12} /> : null}
        {isUndoing ? "撤销中" : "撤销"}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------
   弹窗主组件
   ------------------------------------------------------------ */

function IndexPopup() {
  const theme = useTheme()
  const [toast, showToast] = useToast()

  const [enabled, setEnabled] = useState(true)
  const [isTogglingEnabled, setIsTogglingEnabled] = useState(false)
  const [managedFolders, setManagedFolders] = useState<ManagedFolderView[]>([])
  const [recentUpdates, setRecentUpdates] = useState<OperationLogEntry[]>([])
  const [undoingKey, setUndoingKey] = useState<string | null>(null)
  const [leavingKey, setLeavingKey] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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
        showToast("加载失败，请重新打开弹窗。", "error")
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleEnabled(next: boolean) {
    setIsTogglingEnabled(true)
    const previous = enabled

    // 先乐观更新，让开关即时响应
    setEnabled(next)

    try {
      await setExtensionEnabled(next)
      showToast(next ? "已开启，正在维护托管书签" : "已暂停，不会更新任何书签")
    } catch (error) {
      setEnabled(previous)
      showToast("开关保存失败，请重试。", "error")
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

      showToast(`已撤销「${title}」的最近更新`)

      // 播放行滑出动画，动画结束后从列表移除：它已不代表当前状态，完整历史仍在管理页
      setLeavingKey(key)

      window.setTimeout(() => {
        setRecentUpdates((current) =>
          current.filter((item) => {
            if (item.after.snapshotType !== "bookmark-url") {
              return true
            }

            return `${item.timestamp}-${item.after.bookmarkId}` !== key
          })
        )
        setLeavingKey(null)
      }, 260)
    } catch (error) {
      showToast("撤销失败：书签可能已被删除，或后台为旧版本。", "error")
      console.error("[Dynamic Bookmark] Failed to undo recent update:", error)
    } finally {
      setUndoingKey(null)
    }
  }

  const version = chrome.runtime.getManifest().version

  const statusText = useMemo(() => {
    if (isLoading) {
      return "正在读取状态…"
    }

    if (!enabled) {
      return "已暂停：浏览行为不会被记录，书签也不会被修改。"
    }

    if (managedFolders.length === 0) {
      return "尚未选择托管文件夹，暂时不会有书签被更新。"
    }

    return `正在后台维护 ${managedFolders.length} 个文件夹的书签进度`
  }, [isLoading, enabled, managedFolders])

  return (
    <div className="db-popup">
      <style>{uiCss}</style>
      <style>{`
        html, body { overflow: hidden; }
      `}</style>

      {/* 顶栏：品牌 + 主题快捷切换 + 总开关 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "13px 14px 11px",
          flexShrink: 0
        }}>
        <span style={{ color: "var(--accent)" }}>
          <BrandIcon size={19} />
        </span>
        <span style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: "-0.01em", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Dynamic Bookmark
        </span>

        <button
          type="button"
          className="db-icon-btn"
          onClick={theme.toggleQuick}
          title={
            theme.preference === "auto"
              ? `当前跟随系统（${theme.resolved === "dark" ? "暗色" : "亮色"}），点击切换为${theme.resolved === "dark" ? "亮色" : "暗色"}`
              : `切换为${theme.resolved === "dark" ? "亮色" : "暗色"}主题`
          }>
          {theme.resolved === "dark" ? <SunIcon size={15} /> : <MoonIcon size={15} />}
        </button>

        <Switch
          checked={enabled}
          disabled={isTogglingEnabled}
          title={enabled ? "点击暂停：暂停后不再自动更新书签" : "点击开启：恢复自动更新书签"}
          onChange={(next) => void toggleEnabled(next)}
        />
      </div>

      {/* 运行状态条 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          margin: "0 14px 12px",
          padding: "7px 11px",
          borderRadius: "var(--radius-m)",
          background: enabled ? "var(--accent-bg)" : "var(--s2)",
          border: `1px solid ${enabled ? "var(--accent-line)" : "var(--line)"}`,
          fontSize: 11.5,
          lineHeight: 1.45,
          color: enabled ? "var(--accent)" : "var(--t2)",
          flexShrink: 0
        }}>
        {enabled ? <span className="db-pulse" style={{ width: 6, height: 6 }} /> : <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--t3)", flexShrink: 0 }} />}
        <span style={{ minWidth: 0 }}>{statusText}</span>
      </div>

      {/* 内容区（可滚动） */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {/* 已接管文件夹：只展示，不在这里选 */}
        <div className="db-card" style={{ padding: "10px 12px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span className="db-section-title">
              托管文件夹 · {isLoading ? "加载中" : managedFolders.length > 0 ? `已接管 ${managedFolders.length} 个` : "尚未选择"}
            </span>
            <button className="db-link" onClick={() => openManagePage("folders")}>
              管理
            </button>
          </div>

          {managedFolders.length === 0 ? (
            <button
              type="button"
              onClick={() => openManagePage("folders")}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "9px 10px",
                borderRadius: "var(--radius-m)",
                border: "1px dashed var(--accent-line)",
                background: "transparent",
                color: "var(--accent)",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit"
              }}>
              <FolderIcon size={13} />
              选择要接管的文件夹
            </button>
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 58, overflowY: "auto" }}>
              {managedFolders.map((folder) => (
                <span key={folder.id} className="db-chip db-chip-accent" title={folder.path} style={{ maxWidth: "100%" }}>
                  <FolderIcon size={11} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.title}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 最近更新：可见 + 可撤销 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span className="db-section-title">最近更新</span>
          <button className="db-link db-link-muted" onClick={() => openManagePage("logs")}>
            查看全部
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7, paddingBottom: 2 }}>
          {recentUpdates.length === 0 ? (
            <div className="db-empty" style={{ padding: "20px 12px" }}>
              {isLoading ? "正在加载…" : "还没有书签更新记录。\n关掉一个正在看的课程/视频标签页试试。"}
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
                  isLeaving={leavingKey === key}
                  anyUndoing={undoingKey !== null}
                  onUndo={(target) => void undoRecentUpdate(target)}
                />
              )
            })
          )}
        </div>
      </div>

      {/* 底栏：管理页入口 + 版本号 */}
      <div
        style={{
          flexShrink: 0,
          margin: "10px 14px 12px",
          paddingTop: 11,
          borderTop: "1px solid var(--line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8
        }}>
        <span style={{ fontSize: 11, color: "var(--t3)" }}>v{version}</span>
        <button
          type="button"
          className="db-btn"
          onClick={() => openManagePage("overview")}
          title="打开管理页（托管文件夹 / 操作日志 / 外观设置）"
          style={{ flex: 1, maxWidth: 200 }}>
          打开管理页
          <ChevronRightIcon size={13} />
        </button>
      </div>

      <ToastHost toast={toast} />
    </div>
  )
}

export default IndexPopup
