import { useEffect, useState } from "react"

import uiCss from "data-text:../styles/ui.css"

import { useTheme } from "../theme"
import { ToastHost, useToast } from "../ui/common"
import { BrandIcon, FolderIcon, HomeIcon, LogsIcon, MonitorIcon, MoonIcon, PaletteIcon, SunIcon } from "../ui/icons"
import { AppearanceSection } from "../ui/appearance"
import { FoldersSection } from "../ui/folders"
import { LogsSection } from "../ui/logs"
import { OverviewSection } from "../ui/overview"

type Section = "overview" | "folders" | "logs" | "appearance"

const SECTION_KEYS: Section[] = ["overview", "folders", "logs", "appearance"]

function parseSectionFromHash(): Section {
  const raw = window.location.hash.replace("#", "")

  return (SECTION_KEYS as string[]).includes(raw) ? (raw as Section) : "overview"
}

function openPopup() {
  void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") })
}

function ManagePage() {
  const theme = useTheme()
  const [toast, showToast] = useToast()
  const [section, setSection] = useState<Section>(() => parseSectionFromHash())

  // hash 路由：支持 popup 深链（tabs/manage.html#folders 等）与浏览器前进后退
  useEffect(() => {
    const onHashChange = () => {
      setSection(parseSectionFromHash())
    }

    window.addEventListener("hashchange", onHashChange)

    return () => {
      window.removeEventListener("hashchange", onHashChange)
    }
  }, [])

  function switchSection(next: Section) {
    window.location.hash = next
    setSection(next)
  }

  const version = chrome.runtime.getManifest().version

  const navItems: { key: Section; label: string; icon: JSX.Element }[] = [
    { key: "overview", label: "概览", icon: <HomeIcon size={16} /> },
    { key: "folders", label: "托管文件夹", icon: <FolderIcon size={16} /> },
    { key: "logs", label: "操作日志", icon: <LogsIcon size={16} /> },
    { key: "appearance", label: "外观与通用", icon: <PaletteIcon size={16} /> }
  ]

  return (
    <div className="db-manage">
      <style>{uiCss}</style>

      {/* 侧栏 */}
      <aside className="db-sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "4px 6px 14px" }}>
          <span style={{ color: "var(--accent)" }}>
            <BrandIcon size={19} />
          </span>
          <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "-0.01em" }}>Dynamic Bookmark</span>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {navItems.map((item) => (
            <button key={item.key} className={`db-nav-item${section === item.key ? " on" : ""}`} onClick={() => switchSection(item.key)}>
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>

        <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10, paddingTop: 14 }}>
          <div>
            <div className="db-section-title" style={{ marginBottom: 6, paddingLeft: 2 }}>界面主题</div>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div className="db-seg" style={{ flex: 1 }}>
                <button
                  type="button"
                  title="跟随系统"
                  className={theme.preference === "auto" ? "on-accent" : ""}
                  onClick={() => theme.setPreference("auto")}
                  style={{ flex: 1, justifyContent: "center" }}>
                  <MonitorIcon size={13} />
                </button>
                <button
                  type="button"
                  title="亮色"
                  className={theme.preference === "light" ? "on-accent" : ""}
                  onClick={() => theme.setPreference("light")}
                  style={{ flex: 1, justifyContent: "center" }}>
                  <SunIcon size={13} />
                </button>
                <button
                  type="button"
                  title="暗色"
                  className={theme.preference === "dark" ? "on-accent" : ""}
                  onClick={() => theme.setPreference("dark")}
                  style={{ flex: 1, justifyContent: "center" }}>
                  <MoonIcon size={13} />
                </button>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 2px" }}>
            <span style={{ fontSize: 11, color: "var(--t3)" }}>v{version}</span>
            <button className="db-link db-link-muted" onClick={openPopup} title="打开扩展弹窗">
              弹窗
            </button>
          </div>
        </div>
      </aside>

      {/* 主内容 */}
      <main className="db-main">
        <div className="db-content">
          {section === "overview" && (
            <OverviewSection
              onToast={showToast}
              onNavigate={(next) => switchSection(next)}
            />
          )}
          {section === "folders" && <FoldersSection key="folders" onToast={showToast} />}
          {section === "logs" && <LogsSection key="logs" onToast={showToast} />}
          {section === "appearance" && <AppearanceSection theme={theme} />}
        </div>
      </main>

      <ToastHost toast={toast} />
    </div>
  )
}

export default ManagePage
