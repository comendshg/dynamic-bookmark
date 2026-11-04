import { useCallback, useEffect, useMemo, useState } from "react"

import { RefreshIcon } from "./icons"
import { InlineConfirmButton, SegmentedControl } from "./common"
import { formatDateTime, formatRelativeTime, shortenUrl } from "./format"

import {
  BOOKMARK_OPERATION_LOGS_KEY,
  clearOperationLogs,
  getOperationLogs,
  serializeError,
  type BookmarkUrlSnapshot,
  type OperationLogEntry,
  type OperationSnapshot
} from "../logger"

type LogFilter = "all" | "bookmark-url-update" | "managed-folders-update" | "rollback" | "errors"
type ViewMode = "timeline" | "bookmarks"

const FILTER_DEFS: { key: LogFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "bookmark-url-update", label: "书签更新" },
  { key: "managed-folders-update", label: "配置变更" },
  { key: "rollback", label: "回退记录" },
  { key: "errors", label: "含错误" }
]

type BookmarkHistoryGroup = {
  bookmarkId: string
  title: string
  entries: OperationLogEntry[]
  latestTimestamp: number
}

function typeChipClass(operationType: string, hasError: boolean): string {
  if (hasError) {
    return "db-type-chip db-type-chip-error"
  }

  if (operationType === "bookmark-url-update") {
    return "db-type-chip db-type-chip-update"
  }

  if (operationType === "managed-folders-update") {
    return "db-type-chip db-type-chip-config"
  }

  if (operationType === "rollback") {
    return "db-type-chip db-type-chip-rollback"
  }

  return "db-type-chip"
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

/* ------------------------------------------------------------
   快照展示（变更前 / 变更后）
   ------------------------------------------------------------ */

function SnapshotView(props: { snapshot: OperationSnapshot; tone: "before" | "after" }) {
  const { snapshot, tone } = props
  const isBefore = tone === "before"

  if (snapshot.snapshotType === "managed-folders") {
    return (
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
        <span style={{ flexShrink: 0, width: 40, fontSize: 11, color: isBefore ? "var(--t3)" : "var(--accent)" }}>
          {isBefore ? "变更前" : "变更后"}
        </span>
        {snapshot.folderTitles.length === 0 ? (
          <span style={{ fontSize: 13, color: "var(--t3)" }}>未选择任何文件夹</span>
        ) : (
          <span style={{ fontSize: 13, color: isBefore ? "var(--t2)" : "var(--t1)", wordBreak: "break-all" }}>
            {snapshot.folderTitles.join(" · ")}
          </span>
        )}
      </div>
    )
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ flexShrink: 0, width: 40, fontSize: 11, color: isBefore ? "var(--t3)" : "var(--accent)" }}>
          {isBefore ? "变更前" : "变更后"}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: isBefore ? "var(--t2)" : "var(--t1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>
          {snapshot.bookmarkTitle}
        </span>
      </div>
      <div
        title={snapshot.bookmarkUrl ?? undefined}
        className="mono"
        style={{
          marginTop: 2,
          marginLeft: 50,
          fontSize: 12,
          lineHeight: 1.5,
          color: isBefore ? "var(--t3)" : "var(--t2)",
          wordBreak: "break-all",
          textDecoration: isBefore ? "line-through" : "none"
        }}>
        {snapshot.bookmarkUrl ?? "（无 URL）"}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------
   时间线视图：单条日志卡片
   ------------------------------------------------------------ */

function LogEntryCard(props: {
  entry: OperationLogEntry
  index: number
  isRollingBack: boolean
  anyRollingBack: boolean
  onRollback: (entry: OperationLogEntry) => void
}) {
  const { entry, index, isRollingBack, anyRollingBack, onRollback } = props

  const hasError = !!entry.error
  // 失败的操作没有实际写入，回退它没有意义。
  const canRollback = !hasError

  return (
    <div
      className={`db-card${isRollingBack ? " is-busy" : ""}`}
      style={{ padding: "13px 15px", borderLeft: `3px solid ${hasError ? "var(--danger)" : entry.operationType === "rollback" ? "var(--warn)" : "var(--accent)"}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span className={typeChipClass(entry.operationType, hasError)}>
          {hasError ? `失败 · ${formatOperationTypeLabel(entry.operationType)}` : formatOperationTypeLabel(entry.operationType)}
        </span>

        <span title={formatDateTime(entry.timestamp)} style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--t3)", whiteSpace: "nowrap" }}>
          {formatRelativeTime(entry.timestamp)}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "10px 12px",
          background: "var(--s2)",
          borderRadius: "var(--radius-m)"
        }}>
        <SnapshotView snapshot={entry.before} tone="before" />
        <SnapshotView snapshot={entry.after} tone="after" />
      </div>

      {hasError ? (
        <div
          className="mono"
          style={{
            marginTop: 10,
            fontSize: 11.5,
            lineHeight: 1.6,
            color: "var(--danger)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            background: "var(--danger-bg)",
            border: "1px solid var(--danger-line)",
            borderRadius: "var(--radius-m)",
            padding: "8px 10px"
          }}>
          {entry.error}
        </div>
      ) : (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--t3)" }}>{entry.remark}</div>
      )}

      <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
        <InlineConfirmButton
          label="回退"
          confirmLabel="确认回退？"
          busyLabel="回退中…"
          busy={isRollingBack}
          disabled={anyRollingBack || !canRollback}
          tone="accent"
          title={canRollback ? "把状态恢复到这条记录变更之前" : "该操作未实际生效，无需回退"}
          onConfirm={() => onRollback(entry)}
        />
      </div>

      <span hidden>{index}</span>
    </div>
  )
}

/* ------------------------------------------------------------
   按书签视图：单本书签的版本时间线
   ------------------------------------------------------------ */

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
      className="db-card"
      style={{ borderLeft: "3px solid var(--accent)", overflow: "hidden" }}>
      <button
        onClick={() => setExpanded((current) => !current)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 15px",
          background: "transparent",
          border: "none",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
          fontFamily: "inherit"
        }}>
        <span
          style={{
            flexShrink: 0,
            width: 16,
            fontSize: 11,
            color: "var(--t3)",
            transition: "transform 0.15s ease-out",
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
            color: "var(--t1)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}>
          {group.title || "（无标题书签）"}
        </span>

        {isMissing && <span className="db-chip" style={{ color: "var(--danger)", background: "var(--danger-bg)", borderColor: "var(--danger-line)" }}>书签已删除</span>}

        <span className="db-chip db-chip-accent">{group.entries.length} 个版本</span>

        <span style={{ flexShrink: 0, fontSize: 11.5, color: "var(--t3)", whiteSpace: "nowrap" }}>
          {formatRelativeTime(group.latestTimestamp)}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "0 15px 13px" }}>
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
                  className={`db-row${isRollingBack ? " is-busy" : ""}`}
                  style={{ alignItems: "flex-start" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span title={formatDateTime(entry.timestamp)} style={{ fontSize: 11.5, color: "var(--t2)", whiteSpace: "nowrap" }}>
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                      {isRollbackEntry && <span className="db-type-chip db-type-chip-rollback" style={{ fontSize: 10, padding: "1px 7px" }}>回退操作</span>}
                    </div>

                    {before && (
                      <div
                        title={before.bookmarkUrl ?? undefined}
                        className="mono"
                        style={{
                          fontSize: 11.5,
                          lineHeight: 1.5,
                          color: "var(--t3)",
                          textDecoration: "line-through",
                          wordBreak: "break-all"
                        }}>
                        {shortenUrl(before.bookmarkUrl)}
                      </div>
                    )}

                    <div
                      title={after?.bookmarkUrl ?? undefined}
                      className="mono"
                      style={{
                        fontSize: 11.5,
                        lineHeight: 1.5,
                        color: "var(--accent)",
                        wordBreak: "break-all"
                      }}>
                      → {shortenUrl(after?.bookmarkUrl ?? null)}
                    </div>
                  </div>

                  <InlineConfirmButton
                    label="回退到此"
                    confirmLabel="确认回退？"
                    busyLabel="回退中…"
                    busy={isRollingBack}
                    disabled={anyRollingBack || isMissing}
                    tone="accent"
                    title={isMissing ? "书签已不存在，无法回退" : "恢复到这个版本之前的地址"}
                    onConfirm={() => onRollback(entry, rollbackKey)}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------
   操作日志区（原 log 页核心，逻辑完整保留）
   ------------------------------------------------------------ */

export function LogsSection(props: { onToast: (message: string, tone?: "info" | "error") => void }) {
  const { onToast } = props

  const [logs, setLogs] = useState<OperationLogEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isClearing, setIsClearing] = useState(false)
  const [activeRollbackKey, setActiveRollbackKey] = useState<string | null>(null)
  const [filter, setFilter] = useState<LogFilter>("all")
  const [viewMode, setViewMode] = useState<ViewMode>("timeline")
  // 已不存在的书签 id（书签被删除后，历史仍保留但无法回退）
  const [missingBookmarkIds, setMissingBookmarkIds] = useState<Set<string>>(new Set())

  const loadLogs = useCallback(async () => {
    try {
      const nextLogs = await getOperationLogs()
      setLogs(nextLogs.reverse())
      setIsLoading(false)
    } catch (error) {
      setIsLoading(false)
      onToast(`加载日志失败：${serializeError(error)}`, "error")
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void loadLogs()

    // 日志写入（background 或其他页面回退）时自动刷新列表
    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !changes[BOOKMARK_OPERATION_LOGS_KEY]) {
        return
      }

      void loadLogs()
    }

    chrome.storage.onChanged.addListener(onStorageChanged)

    return () => {
      chrome.storage.onChanged.removeListener(onStorageChanged)
    }
  }, [loadLogs])

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

      if (
        entry.operationType === "bookmark-url-update" ||
        entry.operationType === "managed-folders-update" ||
        entry.operationType === "rollback"
      ) {
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
    setIsClearing(true)

    try {
      await clearOperationLogs()
      setLogs([])
      onToast("已清空全部日志。")
    } catch (error) {
      onToast(`清空日志失败：${serializeError(error)}`, "error")
    } finally {
      setIsClearing(false)
    }
  }

  // 回退：通过 background 消息执行，完成后日志会经 storage 监听自动刷新
  async function handleRollback(entry: OperationLogEntry, rollbackKey: string) {
    setActiveRollbackKey(rollbackKey)

    try {
      const response = await chrome.runtime.sendMessage({
        type: "rollback-operation-log",
        entry
      })

      if (!response?.ok) {
        throw new Error(response?.message ?? "回退失败")
      }

      onToast(response.message ?? "回退已完成。")
    } catch (error) {
      onToast(serializeError(error), "error")
    } finally {
      setActiveRollbackKey(null)
    }
  }

  const anyRollingBack = activeRollbackKey !== null

  return (
    <section>
      <div style={{ marginBottom: 20, display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>操作日志</h1>
          <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--t2)", lineHeight: 1.6 }}>
            书签更新和配置变更的历史记录，支持回退到任意版本；切到「按书签」查看每本书签的地址变迁时间线。
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            className="db-btn"
            onClick={() => void loadLogs()}
            disabled={isLoading}
            title="刷新日志">
            <RefreshIcon size={13} />
            {isLoading ? "刷新中…" : "刷新"}
          </button>
          <InlineConfirmButton
            label="清空全部"
            confirmLabel="确认清空？不可恢复"
            busyLabel="清空中…"
            busy={isClearing}
            disabled={logs.length === 0}
            tone="danger"
            title="清空全部日志，此操作无法恢复"
            onConfirm={() => void handleClearAllLogs()}
          />
        </div>
      </div>

      {logs.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
            paddingBottom: 14,
            borderBottom: "1px solid var(--line)",
            flexWrap: "wrap"
          }}>
          <SegmentedControl
            options={[
              { key: "timeline" as ViewMode, label: "时间线" },
              { key: "bookmarks" as ViewMode, label: "按书签" }
            ]}
            value={viewMode}
            accentActive
            onChange={(next) => setViewMode(next)}
          />

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
                    className={`db-chip${isActive ? " db-chip-accent" : ""}`}
                    onClick={() => setFilter(key)}
                    style={{ cursor: "pointer", fontSize: 12, fontWeight: 500 }}>
                    {label}
                    <span className="db-chip-count">{count}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <span style={{ fontSize: 12, color: "var(--t3)" }}>
              {bookmarkGroups.length} 本书签 · 每本按时间倒序，可回退到任意版本
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="db-empty">正在加载日志…</div>
      ) : logs.length === 0 ? (
        <div className="db-empty" style={{ padding: "48px 14px" }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--t2)" }}>暂无日志记录</div>
          <div style={{ marginTop: 6 }}>关闭标签页更新书签、或修改插件配置后，操作会记录在这里。</div>
        </div>
      ) : viewMode === "bookmarks" ? (
        bookmarkGroups.length === 0 ? (
          <div className="db-empty">暂无书签更新历史。关闭标签页触发书签更新后，这里会按书签展示版本变迁。</div>
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
        <div className="db-empty">当前筛选条件下没有记录。</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredLogs.map((entry, index) => (
            <LogEntryCard
              key={`${entry.timestamp}-${entry.operationType}-${index}`}
              entry={entry}
              index={index}
              isRollingBack={activeRollbackKey === `${entry.timestamp}-${entry.operationType}-${index}`}
              anyRollingBack={anyRollingBack}
              onRollback={(target) => void handleRollback(target, `${target.timestamp}-${target.operationType}-${index}`)}
            />
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <div style={{ marginTop: 14, fontSize: 12, color: "var(--t3)", textAlign: "center" }}>
          共 {logs.length} 条记录，最多保留 100 条
        </div>
      )}
    </section>
  )
}
