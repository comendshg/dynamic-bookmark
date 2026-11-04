import { useCallback, useEffect, useRef, useState } from "react"

import { CheckIcon } from "./icons"

/* ------------------------------------------------------------
   Toast —— 替代页面底部常驻状态文字
   ------------------------------------------------------------ */

export type ToastTone = "info" | "error"

export type ToastState = { message: string; tone: ToastTone; key: number } | null

const TOAST_DURATION_MS = 2800

export function useToast(): [ToastState, (message: string, tone?: ToastTone) => void] {
  const [toast, setToast] = useState<ToastState>(null)
  const timerRef = useRef<number | undefined>(undefined)

  const showToast = useCallback((message: string, tone: ToastTone = "info") => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
    }

    setToast({ message, tone, key: Date.now() })

    timerRef.current = window.setTimeout(() => {
      setToast(null)
    }, TOAST_DURATION_MS)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  return [toast, showToast]
}

export function ToastHost(props: { toast: ToastState }) {
  const { toast } = props

  if (!toast) {
    return null
  }

  return <div key={toast.key} className={`db-toast${toast.tone === "error" ? " error" : ""}`} role="status">{toast.message}</div>
}

/* ------------------------------------------------------------
   Switch —— 总开关（纯样式开关，状态由外部控制）
   ------------------------------------------------------------ */

export function Switch(props: {
  checked: boolean
  disabled?: boolean
  title?: string
  onChange: (next: boolean) => void
}) {
  const { checked, disabled, title, onChange } = props

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      title={title}
      disabled={disabled}
      className={`db-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    />
  )
}

/* ------------------------------------------------------------
   InlineConfirmButton —— 二次点击确认（替代 window.confirm）
   第一次点击进入待确认态，3.2 秒内再点一次才执行；超时自动取消。
   ------------------------------------------------------------ */

const ARM_TIMEOUT_MS = 3200

export function InlineConfirmButton(props: {
  label: string
  confirmLabel: string
  onConfirm: () => void
  tone?: "accent" | "danger"
  disabled?: boolean
  busy?: boolean
  busyLabel?: string
  title?: string
  className?: string
}) {
  const {
    label,
    confirmLabel,
    onConfirm,
    tone = "danger",
    disabled = false,
    busy = false,
    busyLabel = "处理中…",
    title,
    className = ""
  } = props

  const [armed, setArmed] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  function handleClick() {
    if (armed) {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
      setArmed(false)
      onConfirm()
      return
    }

    setArmed(true)
    timerRef.current = window.setTimeout(() => {
      setArmed(false)
    }, ARM_TIMEOUT_MS)
  }

  const busyOrDisabled = disabled || busy

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busyOrDisabled}
      title={title}
      className={`db-btn db-btn-sm db-btn-${tone}${armed ? " db-btn-primary" : ""}${className ? ` ${className}` : ""}`}>
      {busy ? busyLabel : armed ? confirmLabel : label}
    </button>
  )
}

/* ------------------------------------------------------------
   SegmentedControl —— 分段切换（视图切换 / 主题三态）
   ------------------------------------------------------------ */

export function SegmentedControl<T extends string>(props: {
  options: { key: T; label: string }[]
  value: T
  accentActive?: boolean
  onChange: (next: T) => void
}) {
  const { options, value, accentActive = false, onChange } = props

  return (
    <div className="db-seg" role="tablist">
      {options.map((option) => {
        const isActive = option.key === value

        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={isActive ? (accentActive ? "on-accent" : "on") : ""}
            onClick={() => onChange(option.key)}>
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------
   StatCard —— 概览统计小卡
   ------------------------------------------------------------ */

export function StatCard(props: { label: string; value: string | number; hint?: string }) {
  const { label, value, hint } = props

  return (
    <div className="db-card" style={{ padding: "14px 16px", minWidth: 132, flex: 1 }}>
      <div className="db-section-title">{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 6, lineHeight: 1.2 }}>{value}</div>
      {hint && (
        <div style={{ fontSize: 11.5, color: "var(--t3)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {hint}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------
   SavedFlash —— 「已自动保存」短暂闪现提示
   ------------------------------------------------------------ */

export function SavedFlash(props: { visible: boolean; text?: string }) {
  const { visible, text = "已自动保存" } = props

  if (!visible) {
    return null
  }

  return (
    <span className="db-saved-flash" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <CheckIcon size={12} />
      {text}
    </span>
  )
}
