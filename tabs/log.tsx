import { useEffect, useMemo, useState } from "react"

import {
  clearOperationLogs,
  getOperationLogs,
  serializeError,
  type BookmarkUrlSnapshot,
  type OperationLogEntry,
  type OperationSnapshot
} from "../logger"

type StatusKind = "idle" | "loading" | "error"

type LogFilter = "all" | "bookmark-url-update" | "managed-folders-update" | "rollback" | "errors"

type ViewMode = "timeline" | "bookmarks"

type BookmarkHistoryGroup = {
  bookmarkId: string
  title: string
  entries: OperationLogEntry[]
  latestTimestamp: number
}

const FILTER_DEFS: { key: LogFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "bookmark-url-update", label: "书签更新" },
  { key: "managed-folders-update", label: "配置变更" },
  { key: "rollback", label: "回退记录" },
  { key: "errors", label: "含错误" }
]

type Accent = { color: string; bg: string; border: string }

function typeAccent(operationType: string, hasError: boolean): Accent {
  if (hasError) {
    return { color: "#FCA5A5", bg: "rgba(248, 113, 113, 0.10)", border: "rgba(248, 113, 113, 0.30)" }
  }

  if (operationType === "bookmark-url-update") {
    return { color: "#5EEAD4", bg: "rgba(94, 234, 212, 0.10)", border: "rgba(94, 234, 212, 0.28)" }
  }

  if (operationType === "managed-folders-update") {
    return { color: "#93C5FD", bg: "rgba(147, 197, 253, 0.10)", border: "rgba(147, 197, 253, 0.28)" }
  }

  if (operationType === "rollback") {
    return { color: "#FCD34D", bg: "rgba(252, 211, 77, 0.10)", border: "rgba(252, 211, 77, 0.28)" }
  }

  return { color: "#CBD5E1", bg: "rgba(203, 213, 225, 0.08)", border: "rgba(203, 213, 225, 0.20)" }
}

function formatOperationTypeLabel(operationType: string): string {
  if (operationType === "bookmark-url-update") {
    return "书签更新"
  }

  if (operationType === "managed-folders-update") {
    return "配置变更"
  }

  if (operationType === "rollback") {
    return "回退"
  }

  return operationType
}

function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  })
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

  const diffDays = Math.floor(diffHours / 24)

  if (diffDays < 30) {
    return `${diffDays} 天前`
  }

  return formatDateTime(timestamp)
}

function getBookmarkSnapshot(entry: OperationLogEntry): BookmarkUrlSnapshot | undefined {
  if (entry.after.snapshotType === "bookmark-url") {
    return entry.after
  }

  if (entry.before.snapshotType === "bookmark-url") {
    return entry.before
  }

  return undefined
}

// 按书签把历史记录分组：只关心真正生效过的书签相关操作（排除失败记录）。
// 每组内部按时间从新到旧排列，组之间按最近一次变动时间排序。
function groupLogsByBookmark(logs: OperationLogEntry[]): BookmarkHistoryGroup[] {
  const groups = new Map<string, BookmarkHistoryGroup>()

  for (const entry of logs) {
    if (entry.error) continue
    if (entry.operationType !== "bookmark-url-update" && entry.operationType !== "rollback") continue

    const snapshot = getBookmarkSnapshot(entry)

    if (!snapshot) continue

    const existing = groups.get(snapshot.bookmarkId)

    if (existing) {
      existing.entries.push(entry)
      existing.latestTimestamp = Math.max(existing.latestTimestamp, entry.timestamp)
    } else {
      groups.set(snapshot.bookmarkId, {
        bookmarkId: snapshot.bookmarkId,
        // logs 已按新到旧排列，首次遇到的就是最新标题
        title: snapshot.bookmarkTitle,
        entries: [entry],
        latestTimestamp: entry.timestamp
      })
    }
  }

  return [...groups.values()].sort((a, b) => b.latestTimestamp - a.latestTimestamp)
}

function truncateUrl(url: string | null, maxLength = 52): string {
  if (!url) {
    return "（无 URL）"
  }

  return url.length > maxLength ? url.slice(0, maxLength - 1) + "…" : url
}

function SnapshotView(props: { snapshot: OperationSnapshot; tone: "before" | "after" }) {
  const { snapshot, tone } = props
  const isBefore = tone === "before"

  if (snapshot.snapshotType === "managed-folders") {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
        <span style={{ flexShrink: 0, width: 40, fontSize: 11, color: isBefore ? "#64748B" : "#5EEAD4" }}>
          {isBefore ? "变更前" : "变更后"}
        </span>
        {snapshot.folderTitles.length === 0 ? (
          <span style={{ fontSize: 13, color: "#64748B" }}>未选择任何文件夹</span>
        ) : (
          <span style={{ fontSize: 13, color: isBefore ? "#94A3B8" : "#E2E8F0", wordBreak: "break-all" }}>
            {snapshot.folderTitles.join(" · ")}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ flexShrink: 0, width: 40, fontSize: 11, color: isBefore ? "#64748B" : "#5EEAD4" }}>
          {isBefore ? "变更前" : "变更后"}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: isBefore ? "#94A3B8" : "#F1F5F9",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>
          {snapshot.bookmarkTitle}
        </span>
      </div>
      <div
        title={snapshot.bookmarkUrl ?? undefined}
        style={{
          marginTop: 2,
          marginLeft: 50,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 12,
          lineHeight: 1.5,
          color: isBefore ? "#64748B" : "#94A3B8",
          wordBreak: "break-all",
          textDecoration: isBefore ? "line-through" : "none"
        }}>
        {snapshot.bookmarkUrl ?? "（无 URL）"}
      </div>
    </div>
  )
}

function LogEntryCard(props: {
  entry: OperationLogEntry
  index: number
  isRollingBack: boolean
  anyRollingBack: boolean
  onRollback: (entry: OperationLogEntry, rollbackKey: string) => void
}) {
  const { entry, index, isRollingBack, anyRollingBack, onRollback } = props
  // 同一毫秒内可能出现多条类型相同的日志，key 需拼上序号保证唯一。
  const rollbackKey = `${entry.timestamp}-${entry.operationType}-${index}`
  const hasError = !!entry.error
  const accent = typeAccent(entry.operationType, hasError)
  // 失败的操作没有实际写入，回退它没有意义。
  const canRollback = !hasError

  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        borderLeft: `3px solid ${accent.color}`,
        opacity: isRollingBack ? 0.65 : 1,
        transition: "opacity 0.15s ease"
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 500,
            padding: "3px 10px",
            borderRadius: 999,
            color: accent.color,
            background: accent.bg,
            border: `1px solid ${accent.border}`,
            whiteSpace: "nowrap"
          }}>
          {hasError ? `失败 · ${formatOperationTypeLabel(entry.operationType)}` : formatOperationTypeLabel(entry.operationType)}
        </span>

        <span
          title={formatDateTime(entry.timestamp)}
          style={{ marginLeft: "auto", fontSize: 12, color: "#64748B", whiteSpace: "nowrap" }}>
          {formatRelativeTime(entry.timestamp)}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "10px 12px",
          background: "rgba(0, 0, 0, 0.25)",
          borderRadius: 8
        }}>
        <SnapshotView snapshot={entry.before} tone="before" />
        <SnapshotView snapshot={entry.after} tone="after" />
      </div>

      {hasError ? (
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            lineHeight: 1.6,
            color: "#FCA5A5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            background: "rgba(248, 113, 113, 0.06)",
            border: "1px solid rgba(248, 113, 113, 0.20)",
            borderRadius: 8,
            padding: "8px 10px"
          }}>
          {entry.error}
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 12, color: "#64748B" }}>{entry.remark}</div>
      )}

      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
        <button
          disabled={anyRollingBack || !canRollback}
          title={canRollback ? "把状态恢复到这条记录变更之前" : "该操作未实际生效，无需回退"}
          onClick={() => onRollback(entry, rollbackKey)}
          style={{
            border: "1px solid rgba(94, 234, 212, 0.30)",
            borderRadius: 8,
            padding: "7px 14px",
            background: isRollingBack ? "rgba(94, 234, 212, 0.25)" : "rgba(94, 234, 212, 0.10)",
            color: "#5EEAD4",
            fontSize: 13,
            fontWeight: 500,
            cursor: anyRollingBack || !canRollback ? "not-allowed" : "pointer",
            opacity: canRollback ? 1 : 0.45,
            transition: "background 0.15s ease"
          }}>
          {isRollingBack ? "回退中..." : "回退"}
        </button>
      </div>
    </div>
  )
}

function BookmarkHistoryCard(props: {
  group: BookmarkHistoryGroup
  isMissing: boolean
  activeRollbackKey: string | null
  onRollback: (entry: OperationLogEntry, rollbackKey: string) => void
}) {
  const { group, isMissing, activeRollbackKey, onRollback } = props
  const [expanded, setExpanded] = useState(true)
  const anyRollingBack = activeRollbackKey !== null

  return (
    <div
      style={{
        borderRadius: 12,
        background: "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.06)",
        borderLeft: "3px solid #2DD4BF",
        overflow: "hidden"
      }}>
      <button
        onClick={() => setExpanded((current) => !current)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "13px 16px",
          background: "transparent",
          border: "none",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer"
        }}>
        <span
          style={{
            flexShrink: 0,
            width: 16,
            fontSize: 11,
            color: "#64748B",
            transition: "transform 0.15s ease",
            transform: expanded ? "rotate(90deg)" : "none"
          }}>
          ▶
        </span>

        <span
          style={{
            minWidth: 0,
            flex: 1,
            fontSize: 14,
            fontWeight: 500,
            color: "#F1F5F9",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>
          {group.title || "（无标题书签）"}
        </span>

        {isMissing && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 10.5,
              padding: "2px 8px",
              borderRadius: 999,
              color: "#FCA5A5",
              background: "rgba(248, 113, 113, 0.10)",
              border: "1px solid rgba(248, 113, 113, 0.28)"
            }}>
            书签已删除
          </span>
        )}

        <span
          style={{
            flexShrink: 0,
            fontSize: 10.5,
            padding: "2px 8px",
            borderRadius: 999,
            color: "#5EEAD4",
            background: "rgba(94, 234, 212, 0.10)",
            border: "1px solid rgba(94, 234, 212, 0.24)"
          }}>
          {group.entries.length} 个版本
        </span>

        <span style={{ flexShrink: 0, fontSize: 11.5, color: "#64748B", whiteSpace: "nowrap" }}>
          {formatRelativeTime(group.latestTimestamp)}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 10 }}>
            {group.entries.map((entry, index) => {
              const rollbackKey = `bookmark-${group.bookmarkId}-${entry.timestamp}-${index}`
              const isRollingBack = activeRollbackKey === rollbackKey
              const before = entry.before.snapshotType === "bookmark-url" ? entry.before : undefined
              const after = entry.after.snapshotType === "bookmark-url" ? entry.after : undefined
              const isRollbackEntry = entry.operationType === "rollback"

              return (
                <div
                  key={rollbackKey}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "10px 12px",
                    borderRadius: 9,
                    background: "rgba(0, 0, 0, 0.22)",
                    border: "1px solid rgba(255, 255, 255, 0.04)",
                    opacity: isRollingBack ? 0.65 : 1
                  }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span
                        title={formatDateTime(entry.timestamp)}
                        style={{ fontSize: 11.5, color: "#94A3B8", whiteSpace: "nowrap" }}>
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                      {isRollbackEntry && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 7px",
                            borderRadius: 999,
                            color: "#FCD34D",
                            background: "rgba(252, 211, 77, 0.10)",
                            border: "1px solid rgba(252, 211, 77, 0.26)"
                          }}>
                          回退操作
                        </span>
                      )}
                    </div>

                    {before && (
                      <div
                        title={before.bookmarkUrl ?? undefined}
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                          fontSize: 11.5,
                          lineHeight: 1.5,
                          color: "#64748B",
                          textDecoration: "line-through",
                          wordBreak: "break-all"
                        }}>
                        {truncateUrl(before.bookmarkUrl)}
                      </div>
                    )}

                    <div
                      title={after?.bookmarkUrl ?? undefined}
                      style={{
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        fontSize: 11.5,
                        lineHeight: 1.5,
                        color: "#A7F3D0",
                        wordBreak: "break-all"
                      }}>
                      → {truncateUrl(after?.bookmarkUrl ?? null)}
                    </div>
                  </div>

                  <button
                    disabled={anyRollingBack || isMissing}
                    title={isMissing ? "书签已不存在，无法回退" : "恢复到这个版本之前的地址"}
                    onClick={() => onRollback(entry, rollbackKey)}
                    style={{
                      flexShrink: 0,
                      border: "1px solid rgba(94, 234, 212, 0.28)",
                      borderRadius: 7,
                      padding: "6px 10px",
                      background: isRollingBack ? "rgba(94, 234, 212, 0.25)" : "rgba(94, 234, 212, 0.08)",
                      color: "#5EEAD4",
                      fontSize: 11.5,
                      fontWeight: 500,
                      cursor: anyRollingBack || isMissing ? "not-allowed" : "pointer",
                      opacity: isMissing ? 0.4 : 1,
                      whiteSpace: "nowrap"
                    }}>
                    {isRollingBack ? "回退中..." : "回退到此"}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function IndexLogPage() {
  const [logs, setLogs] = useState<OperationLogEntry[]>([])
  const [statusKind, setStatusKind] = useState<StatusKind>("loading")
  const [statusMessage, setStatusMessage] = useState("")
  const [isClearing, setIsClearing] = useState(false)
  const [activeRollbackKey, setActiveRollbackKey] = useState<string | null>(null)
  const [filter, setFilter] = useState<LogFilter>("all")
  const [viewMode, setViewMode] = useState<ViewMode>("timeline")
  // 已不存在的书签 id（书签被删除后，历史仍保留但无法回退）
  const [missingBookmarkIds, setMissingBookmarkIds] = useState<Set<string>>(new Set())

  async function loadLogs() {
    setStatusKind("loading")

    try {
      const nextLogs = await getOperationLogs()
      setLogs(nextLogs.reverse())
      setStatusMessage("")
      setStatusKind("idle")
    } catch (error) {
      setStatusKind("error")
      setStatusMessage(`加载日志失败：${serializeError(error)}`)
    }
  }

  useEffect(() => {
    void loadLogs()
  }, [])

  const filterCounts = useMemo(() => {
    const counts = new Map<LogFilter, number>([
      ["all", logs.length],
      ["bookmark-url-update", 0],
      ["managed-folders-update", 0],
      ["rollback", 0],
      ["errors", 0]
    ])

    for (const entry of logs) {
      counts.set("errors", (counts.get("errors") ?? 0) + (entry.error ? 1 : 0))

      if (entry.operationType === "bookmark-url-update" || entry.operationType === "managed-folders-update" || entry.operationType === "rollback") {
        counts.set(entry.operationType, (counts.get(entry.operationType as LogFilter) ?? 0) + 1)
      }
    }

    return counts
  }, [logs])

  const filteredLogs = useMemo(() => {
    if (filter === "all") {
      return logs
    }

    if (filter === "errors") {
      return logs.filter((entry) => entry.error)
    }

    return logs.filter((entry) => entry.operationType === filter)
  }, [logs, filter])

  // 按书签分组：数据源同样是操作日志，只是换个视角看
  const bookmarkGroups = useMemo(() => groupLogsByBookmark(logs), [logs])

  // 书签可能已被删除：一次查询所有分组涉及的书签是否还存在
  useEffect(() => {
    let isActive = true
    const ids = bookmarkGroups.map((group) => group.bookmarkId)

    if (ids.length === 0) {
      setMissingBookmarkIds(new Set())
      return () => {
        isActive = false
      }
    }

    async function checkBookmarksExist() {
      const missing = new Set<string>()

      await Promise.all(
        ids.map(async (id) => {
          try {
            const nodes = await chrome.bookmarks.get(id)

            if (nodes.length === 0) {
              missing.add(id)
            }
          } catch {
            missing.add(id)
          }
        })
      )

      if (isActive) {
        setMissingBookmarkIds(missing)
      }
    }

    void checkBookmarksExist()

    return () => {
      isActive = false
    }
  }, [bookmarkGroups])

  async function handleClearAllLogs() {
    const confirmed = window.confirm("确定要清空全部日志吗？此操作无法恢复。")

    if (!confirmed) {
      return
    }

    setIsClearing(true)

    try {
      await clearOperationLogs()
      setLogs([])
      setStatusKind("idle")
      setStatusMessage("已清空全部日志。")
    } catch (error) {
      setStatusKind("error")
      setStatusMessage(`清空日志失败：${serializeError(error)}`)
    } finally {
      setIsClearing(false)
    }
  }

  async function handleRollback(entry: OperationLogEntry, rollbackKey: string) {
    const confirmed = window.confirm("确定回退到这条历史记录对应的状态吗？")

    if (!confirmed) {
      return
    }

    setActiveRollbackKey(rollbackKey)

    try {
      const response = await chrome.runtime.sendMessage({
        type: "rollback-operation-log",
        entry
      })

      if (!response?.ok) {
        throw new Error(response?.message ?? "回退失败")
      }

      setStatusKind("idle")
      setStatusMessage(response.message ?? "回退已完成。")
      await loadLogs()
    } catch (error) {
      setStatusKind("error")
      setStatusMessage(serializeError(error))
    } finally {
      setActiveRollbackKey(null)
    }
  }

  const anyRollingBack = activeRollbackKey !== null

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 24,
        boxSizing: "border-box",
        background: "#12141A",
        color: "#F8FAFC",
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
      }}>
      <style>
        {`
          html, body {
            margin: 0;
            padding: 0;
            background: #12141A;
          }
          ::-webkit-scrollbar { width: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
        `}
      </style>

      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
          padding: 20
        }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 0.2 }}>日志查看</div>
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: "#94A3B8" }}>
              展示书签更新和配置变更的历史记录，支持按记录回退到变更前的状态；切到「按书签」可查看每本书签的地址变迁时间线。
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            <button
              onClick={() => void loadLogs()}
              disabled={statusKind === "loading"}
              style={{
                border: "1px solid rgba(255, 255, 255, 0.10)",
                borderRadius: 8,
                padding: "10px 14px",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#F8FAFC",
                fontSize: 13,
                cursor: statusKind === "loading" ? "not-allowed" : "pointer"
              }}>
              {statusKind === "loading" ? "刷新中..." : "刷新"}
            </button>
            <button
              onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") })}
              style={{
                border: "1px solid rgba(255, 255, 255, 0.10)",
                borderRadius: 8,
                padding: "10px 14px",
                background: "rgba(255, 255, 255, 0.04)",
                color: "#F8FAFC",
                fontSize: 13,
                cursor: "pointer"
              }}>
              返回首页
            </button>
            <button
              disabled={isClearing || logs.length === 0}
              onClick={handleClearAllLogs}
              style={{
                borderRadius: 8,
                padding: "10px 14px",
                background: isClearing ? "#475569" : "rgba(220, 38, 38, 0.18)",
                border: "1px solid rgba(220, 38, 38, 0.35)",
                color: "#FCA5A5",
                fontSize: 13,
                cursor: isClearing || logs.length === 0 ? "not-allowed" : "pointer",
                opacity: logs.length === 0 ? 0.5 : 1
              }}>
              {isClearing ? "清空中..." : "清空全部"}
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 8,
              background: statusKind === "error" ? "rgba(220, 38, 38, 0.10)" : "rgba(34, 123, 122, 0.12)",
              border: statusKind === "error" ? "1px solid rgba(220, 38, 38, 0.25)" : "1px solid rgba(34, 123, 122, 0.25)",
              color: statusKind === "error" ? "#FCA5A5" : "#A7F3D0",
              fontSize: 13
            }}>
            {statusMessage}
          </div>
        )}

        {logs.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 14,
              paddingBottom: 14,
              borderBottom: "1px solid rgba(255, 255, 255, 0.06)"
            }}>
            <div
              style={{
                display: "inline-flex",
                padding: 3,
                borderRadius: 999,
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                gap: 2
              }}>
              {([
                { key: "timeline" as ViewMode, label: "时间线" },
                { key: "bookmarks" as ViewMode, label: "按书签" }
              ]).map(({ key, label }) => {
                const isActive = viewMode === key

                return (
                  <button
                    key={key}
                    onClick={() => setViewMode(key)}
                    style={{
                      padding: "5px 14px",
                      borderRadius: 999,
                      border: "none",
                      fontSize: 12,
                      fontWeight: 500,
                      color: isActive ? "#12141A" : "#CBD5E1",
                      background: isActive ? "#5EEAD4" : "transparent",
                      cursor: "pointer",
                      transition: "all 0.12s ease"
                    }}>
                    {label}
                  </button>
                )
              })}
            </div>

            {viewMode === "timeline" ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {FILTER_DEFS.map(({ key, label }) => {
                  const count = filterCounts.get(key) ?? 0

                  if (key !== "all" && count === 0) {
                    return null
                  }

                  const isActive = filter === key

                  return (
                    <button
                      key={key}
                      onClick={() => setFilter(key)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 12px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 500,
                        color: isActive ? "#12141A" : "#CBD5E1",
                        background: isActive ? "#5EEAD4" : "rgba(255, 255, 255, 0.04)",
                        border: `1px solid ${isActive ? "#5EEAD4" : "rgba(255, 255, 255, 0.10)"}`,
                        cursor: "pointer",
                        transition: "all 0.12s ease"
                      }}>
                      {label}
                      <span style={{ fontSize: 11, opacity: 0.75 }}>{count}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <span style={{ fontSize: 12, color: "#64748B" }}>
                {bookmarkGroups.length} 本书签 · 每本按时间倒序，可回退到任意版本
              </span>
            )}
          </div>
        )}

        {statusKind === "loading" ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "#94A3B8" }}>
            正在加载日志...
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: "56px 0", textAlign: "center" }}>
            <svg
              width="44"
              height="44"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#475569"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: "0 auto 14px", display: "block" }}>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <div style={{ fontSize: 14, fontWeight: 500, color: "#94A3B8" }}>暂无日志记录</div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#64748B" }}>
              关闭标签页更新书签、或修改插件配置后，操作会记录在这里。
            </div>
          </div>
        ) : viewMode === "bookmarks" ? (
          bookmarkGroups.length === 0 ? (
            <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "#64748B" }}>
              暂无书签更新历史。关闭标签页触发书签更新后，这里会按书签展示版本变迁。
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {bookmarkGroups.map((group) => (
                <BookmarkHistoryCard
                  key={group.bookmarkId}
                  group={group}
                  isMissing={missingBookmarkIds.has(group.bookmarkId)}
                  activeRollbackKey={activeRollbackKey}
                  onRollback={(entry, rollbackKey) => void handleRollback(entry, rollbackKey)}
                />
              ))}
            </div>
          )
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "#64748B" }}>
            当前筛选条件下没有记录。
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {filteredLogs.map((entry, index) => (
              <LogEntryCard
                key={`${entry.timestamp}-${entry.operationType}-${index}`}
                entry={entry}
                index={index}
                isRollingBack={activeRollbackKey === `${entry.timestamp}-${entry.operationType}-${index}`}
                anyRollingBack={anyRollingBack}
                onRollback={(e, rollbackKey) => void handleRollback(e, rollbackKey)}
              />
            ))}
          </div>
        )}

        {logs.length > 0 && (
          <div style={{ marginTop: 14, fontSize: 12, color: "#64748B", textAlign: "center" }}>
            共 {logs.length} 条记录，最多保留 100 条
          </div>
        )}
      </div>
    </div>
  )
}

export default IndexLogPage
