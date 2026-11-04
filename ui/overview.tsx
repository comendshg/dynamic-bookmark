import { useEffect, useState } from "react"

import { StatCard, Switch } from "./common"
import { formatRelativeTime } from "./format"
import {
  getExtensionEnabled,
  getManagedFolderIds,
  getOperationLogs,
  resolveFolderPaths,
  setExtensionEnabled,
  type OperationLogEntry
} from "../logger"

type OverviewData = {
  enabled: boolean
  managedFolderCount: number
  managedFolderTitles: string[]
  totalUpdates: number
  rollbackCount: number
  errorCount: number
  recentEntries: OperationLogEntry[]
}

// 概览区：运行状态 + 统计 + 最近动态
export function OverviewSection(props: {
  onToast: (message: string, tone?: "info" | "error") => void
  onNavigate: (section: "folders" | "logs") => void
}) {
  const { onToast, onNavigate } = props

  const [data, setData] = useState<OverviewData | null>(null)
  const [isToggling, setIsToggling] = useState(false)

  useEffect(() => {
    let isActive = true

    async function loadOverview() {
      try {
        const [enabled, folderIds, logs] = await Promise.all([
          getExtensionEnabled(),
          getManagedFolderIds(),
          getOperationLogs()
        ])

        const folderTitles = await resolveFolderPaths(folderIds)

        if (!isActive) return

        setData({
          enabled,
          managedFolderCount: folderTitles.length,
          managedFolderTitles: folderTitles,
          totalUpdates: logs.filter((entry) => entry.operationType === "bookmark-url-update" && !entry.error).length,
          rollbackCount: logs.filter((entry) => entry.operationType === "rollback").length,
          errorCount: logs.filter((entry) => entry.error).length,
          recentEntries: logs.slice(-5).reverse()
        })
      } catch (error) {
        console.error("[Dynamic Bookmark] Failed to load overview:", error)
        onToast("加载概览数据失败，请切换页面重试。", "error")
      }
    }

    void loadOverview()

    return () => {
      isActive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function toggleEnabled(next: boolean) {
    if (!data) return

    setIsToggling(true)
    const previous = data.enabled

    // 先乐观更新，让开关即时响应
    setData({ ...data, enabled: next })

    try {
      await setExtensionEnabled(next)
      onToast(next ? "已开启，正在维护托管书签" : "已暂停，不会更新任何书签")
    } catch (error) {
      setData((current) => (current ? { ...current, enabled: previous } : current))
      onToast("开关保存失败，请重试。", "error")
      console.error("[Dynamic Bookmark] Failed to toggle extension:", error)
    } finally {
      setIsToggling(false)
    }
  }

  if (!data) {
    return <div className="db-empty">正在加载概览…</div>
  }

  return (
    <section>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>概览</h1>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--t2)", lineHeight: 1.6 }}>
          关闭标签页时，自动把托管文件夹里的书签更新到最近浏览的位置。
        </p>
      </div>

      {/* 运行状态 */}
      <div className="db-card" style={{ padding: "16px 18px", display: "flex", alignItems: "center", gap: 14 }}>
        {data.enabled ? (
          <span className="db-pulse" />
        ) : (
          <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--t3)", flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>
            {data.enabled ? "运行中" : "已暂停"}
          </div>
          <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>
            {data.enabled
              ? data.managedFolderCount > 0
                ? `正在维护 ${data.managedFolderCount} 个文件夹的书签进度`
                : "尚未选择托管文件夹，暂时不会有书签被更新"
              : "浏览行为不会被记录，书签也不会被修改"}
          </div>
        </div>
        <Switch
          checked={data.enabled}
          disabled={isToggling}
          title={data.enabled ? "点击暂停：暂停后不再自动更新书签" : "点击开启：恢复自动更新书签"}
          onChange={(next) => void toggleEnabled(next)}
        />
      </div>

      {/* 统计 */}
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <StatCard label="已接管文件夹" value={data.managedFolderCount} hint={data.managedFolderTitles.slice(0, 2).join(" · ") || "尚未选择"} />
        <StatCard label="累计书签更新" value={data.totalUpdates} hint="关闭标签页自动写入" />
        <StatCard label="回退次数" value={data.rollbackCount} hint="含自动与手动回退" />
        <StatCard label="错误记录" value={data.errorCount} hint="近 100 条日志内" />
      </div>

      {/* 最近动态 */}
      <div className="db-card" style={{ padding: 16, marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span className="db-section-title">最近动态</span>
          <button className="db-link" onClick={() => onNavigate("logs")}>
            查看全部日志 →
          </button>
        </div>

        {data.recentEntries.length === 0 ? (
          <div className="db-empty">还没有任何记录。关掉一个正在看的课程/视频标签页试试。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.recentEntries.map((entry, index) => (
                <div
                  key={`${entry.timestamp}-${entry.operationType}-${index}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: "var(--radius-m)",
                    background: "var(--s2)",
                    border: "1px solid var(--line)",
                    fontSize: 12.5
                  }}>
                  <span style={{ flexShrink: 0, color: entry.error ? "var(--danger)" : "var(--t2)", fontSize: 11.5, whiteSpace: "nowrap" }}>
                    {formatRelativeTime(entry.timestamp)}
                  </span>
                  <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--t1)" }}>
                    {entry.after.snapshotType === "bookmark-url" && entry.before.snapshotType === "bookmark-url"
                      ? `${entry.after.bookmarkTitle} 的地址已更新`
                      : entry.operationType === "rollback"
                        ? "执行了一次回退"
                        : "托管文件夹配置已变更"}
                  </span>
                  <button className="db-link" style={{ flexShrink: 0 }} onClick={() => onNavigate("logs")}>
                    详情
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>
    </section>
  )
}
