import { useEffect, useState } from "react"

import {
  clearOperationLogs,
  formatOperationSnapshot,
  getOperationLogs,
  serializeError,
  type OperationLogEntry
} from "../logger"

type StatusKind = "idle" | "loading" | "saving" | "error"

function formatOperationType(operationType: string): string {
  if (operationType === "bookmark-url-update") {
    return "书签 URL 更新"
  }

  if (operationType === "managed-folders-update") {
    return "配置变更"
  }

  if (operationType === "rollback") {
    return "执行回退操作"
  }

  return operationType
}

function describeChange(entry: OperationLogEntry): string {
  return `${formatOperationSnapshot(entry.before)} -> ${formatOperationSnapshot(entry.after)}`
}

function IndexLogPage() {
  const [logs, setLogs] = useState<OperationLogEntry[]>([])
  const [statusKind, setStatusKind] = useState<StatusKind>("loading")
  const [statusMessage, setStatusMessage] = useState("")
  const [isClearing, setIsClearing] = useState(false)
  const [activeRollbackKey, setActiveRollbackKey] = useState<string | null>(null)

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

  async function handleRollback(entry: OperationLogEntry) {
    const confirmed = window.confirm("确定回退到这条历史记录对应的状态吗？")

    if (!confirmed) {
      return
    }

    const rollbackKey = `${entry.timestamp}-${entry.operationType}`
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

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 24,
        boxSizing: "border-box",
        background: "#181A1F",
        color: "#F8FAFC",
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
      }}>
      <style>
        {`
          html, body {
            margin: 0;
            padding: 0;
            background: #181A1F;
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 0.2 }}>日志查看</div>
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: "#94A3B8" }}>
              展示书签 URL 更新和配置变更的历史记录，支持按日志快照回退。
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") })}
              style={{
                border: "1px solid rgba(255, 255, 255, 0.1)",
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
              disabled={isClearing}
              onClick={handleClearAllLogs}
              style={{
                border: "none",
                borderRadius: 8,
                padding: "10px 14px",
                background: isClearing ? "#475569" : "#7C2D12",
                color: "#FFF",
                fontSize: 13,
                cursor: isClearing ? "not-allowed" : "pointer"
              }}>
              {isClearing ? "清空中..." : "清空全部日志"}
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 12px",
              borderRadius: 8,
              background: statusKind === "error" ? "rgba(220, 38, 38, 0.1)" : "rgba(34, 123, 122, 0.12)",
              border: statusKind === "error" ? "1px solid rgba(220, 38, 38, 0.25)" : "1px solid rgba(34, 123, 122, 0.25)",
              color: statusKind === "error" ? "#FCA5A5" : "#A7F3D0",
              fontSize: 13
            }}>
            {statusMessage}
          </div>
        )}

        {statusKind === "loading" ? (
          <div style={{ fontSize: 13, color: "#94A3B8" }}>正在加载日志...</div>
        ) : logs.length === 0 ? (
          <div style={{ fontSize: 13, color: "#94A3B8" }}>暂无日志记录。</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {logs.map((entry) => {
              const rollbackKey = `${entry.timestamp}-${entry.operationType}`

              return (
                <div
                  key={rollbackKey}
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.06)"
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{formatOperationType(entry.operationType)}</div>
                    <div style={{ fontSize: 12, color: "#94A3B8", whiteSpace: "nowrap" }}>{new Date(entry.timestamp).toLocaleString()}</div>
                  </div>

                  <div style={{ fontSize: 12, lineHeight: 1.6, color: "#CBD5E1", whiteSpace: "pre-wrap" }}>{describeChange(entry)}</div>

                  <div style={{ marginTop: 8, fontSize: 12, color: entry.error ? "#FCA5A5" : "#94A3B8", whiteSpace: "pre-wrap" }}>
                    {entry.error ? `错误：${entry.error}` : entry.remark}
                  </div>

                  <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
                    <button
                      disabled={Boolean(activeRollbackKey) && activeRollbackKey !== rollbackKey}
                      onClick={() => void handleRollback(entry)}
                      style={{
                        border: "1px solid rgba(34, 123, 122, 0.35)",
                        borderRadius: 8,
                        padding: "8px 12px",
                        background: activeRollbackKey === rollbackKey ? "#475569" : "rgba(34, 123, 122, 0.18)",
                        color: "#E2E8F0",
                        fontSize: 13,
                        cursor: activeRollbackKey ? "not-allowed" : "pointer"
                      }}>
                      {activeRollbackKey === rollbackKey ? "回退中..." : "回退"}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default IndexLogPage
