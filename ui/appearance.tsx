import { MonitorIcon, MoonIcon, SunIcon } from "./icons"
import type { ThemeApi } from "../theme"

// 外观与通用设置区：主题三态 + 说明
export function AppearanceSection(props: { theme: ThemeApi }) {
  const { theme } = props

  const options: { key: "auto" | "light" | "dark"; label: string; icon: JSX.Element; description: string }[] = [
    {
      key: "auto",
      label: "自动",
      icon: <MonitorIcon size={15} />,
      description: `跟随系统（当前系统为${theme.systemDark ? "暗色" : "亮色"}，扩展显示${theme.resolved === "dark" ? "暗色" : "亮色"}）`
    },
    {
      key: "light",
      label: "亮色",
      icon: <SunIcon size={15} />,
      description: "始终使用亮色主题"
    },
    {
      key: "dark",
      label: "暗色",
      icon: <MoonIcon size={15} />,
      description: "始终使用暗色主题"
    }
  ]

  return (
    <section>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>外观与通用</h1>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--t2)", lineHeight: 1.6 }}>
          主题偏好保存在本机，所有页面（弹窗与管理页）实时同步；选择「自动」时跟随浏览器系统主题。
        </p>
      </div>

      <div className="db-card" style={{ padding: 16 }}>
        <div className="db-section-title" style={{ marginBottom: 12 }}>界面主题</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {options.map((option) => {
            const isActive = theme.preference === option.key

            return (
              <button
                key={option.key}
                onClick={() => theme.setPreference(option.key)}
                className={`db-row${isActive ? " is-selected" : ""}`}
                style={{
                  flex: "1 1 180px",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 6,
                  padding: "13px 15px",
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "inherit"
                }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, color: isActive ? "var(--accent)" : "var(--t1)" }}>
                  {option.icon}
                  {option.label}
                </span>
                <span style={{ fontSize: 11.5, color: "var(--t3)", lineHeight: 1.5 }}>{option.description}</span>
              </button>
            )
          })}
        </div>

        {theme.preference !== "auto" && (
          <button className="db-link" style={{ marginTop: 12 }} onClick={() => theme.setPreference("auto")}>
            恢复跟随系统
          </button>
        )}
      </div>

      <div className="db-card" style={{ padding: 16, marginTop: 14, borderStyle: "dashed" }}>
        <div className="db-section-title" style={{ marginBottom: 8 }}>更多设置</div>
        <div style={{ fontSize: 12.5, color: "var(--t3)", lineHeight: 1.7 }}>
          后续会在这里承载更多配置（例如「书签标题是否跟随页面标题」）。当前所有配置仅保存在本机，不会上传。
        </div>
      </div>
    </section>
  )
}
