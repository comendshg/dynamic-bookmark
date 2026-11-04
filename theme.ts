import { useEffect, useState } from "react"

/**
 * 主题系统模块。
 *
 * 偏好值 themePreference 存于 chrome.storage.local，三态：
 * - "auto"：跟随系统 prefers-color-scheme，系统切换时实时响应
 * - "light" / "dark"：手动固定
 *
 * 所有 UI 页面（popup、tabs/manage）通过 storage.onChanged 实时同步：
 * 在任一页面切换主题，其他已打开页面立即换肤。
 * 实际生效的主题以 <html data-theme="..."> 挂载，颜色全部来自 CSS 变量。
 */

export type ThemePreference = "auto" | "light" | "dark"
export type ResolvedTheme = "light" | "dark"

export const THEME_PREFERENCE_KEY = "themePreference"

const storageArea = chrome.storage.local

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "auto" || value === "light" || value === "dark"
}

export async function getThemePreference(): Promise<ThemePreference> {
  try {
    const result = await storageArea.get(THEME_PREFERENCE_KEY)
    const stored = result[THEME_PREFERENCE_KEY]

    return isThemePreference(stored) ? stored : "auto"
  } catch {
    return "auto"
  }
}

export async function setThemePreference(preference: ThemePreference): Promise<void> {
  await storageArea.set({ [THEME_PREFERENCE_KEY]: preference })
}

export function applyResolvedTheme(resolved: ResolvedTheme): void {
  const root = document.documentElement

  root.dataset.theme = resolved
  root.style.colorScheme = resolved
}

function getSystemDarkMedia(): MediaQueryList | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return undefined
  }

  return window.matchMedia("(prefers-color-scheme: dark)")
}

export type ThemeApi = {
  /** 用户偏好（auto / light / dark） */
  preference: ThemePreference
  /** 实际生效的亮/暗 */
  resolved: ResolvedTheme
  /** 当前系统是否偏好暗色 */
  systemDark: boolean
  /** 设置偏好（立即生效并持久化，跨页面同步） */
  setPreference: (preference: ThemePreference) => void
  /** 亮 ↔ 暗快捷切换；从 auto 出发时按当前生效主题反向固定 */
  toggleQuick: () => void
}

export function useTheme(): ThemeApi {
  const [preference, setPreferenceState] = useState<ThemePreference>("auto")
  const [systemDark, setSystemDark] = useState(() => getSystemDarkMedia()?.matches ?? false)

  // 初始读取偏好 + 监听跨页面同步 + 监听系统主题切换
  useEffect(() => {
    let isActive = true

    void getThemePreference().then((stored) => {
      if (isActive) {
        setPreferenceState(stored)
      }
    })

    const onStorageChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") {
        return
      }

      const change = changes[THEME_PREFERENCE_KEY]

      if (!change) {
        return
      }

      if (change.newValue === undefined) {
        setPreferenceState("auto")
        return
      }

      if (isThemePreference(change.newValue)) {
        setPreferenceState(change.newValue)
      }
    }

    chrome.storage.onChanged.addListener(onStorageChanged)

    const media = getSystemDarkMedia()
    const onMediaChange = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches)
    }

    media?.addEventListener("change", onMediaChange)

    return () => {
      isActive = false
      chrome.storage.onChanged.removeListener(onStorageChanged)
      media?.removeEventListener("change", onMediaChange)
    }
  }, [])

  const resolved: ResolvedTheme = preference === "auto" ? (systemDark ? "dark" : "light") : preference

  // 生效主题变化时挂到 <html> 上（CSS 变量随之整体切换）
  useEffect(() => {
    applyResolvedTheme(resolved)
  }, [resolved])

  function setPreference(next: ThemePreference) {
    // 乐观更新本页；storage.onChanged 负责同步其他页面（也会回写本页，值相同无副作用）
    setPreferenceState(next)

    void setThemePreference(next).catch((error) => {
      console.error("[Dynamic Bookmark] Failed to save theme preference:", error)
    })
  }

  function toggleQuick() {
    setPreference(resolved === "dark" ? "light" : "dark")
  }

  return { preference, resolved, systemDark, setPreference, toggleQuick }
}
