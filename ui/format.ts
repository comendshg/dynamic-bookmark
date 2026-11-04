// 各页面共用的时间 / URL 展示格式化工具

export function formatRelativeTime(timestamp: number): string {
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

export function formatDateTime(timestamp: number): string {
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

// 把长 URL 压缩为「域名/…/末段」的形式，用于行内展示
export function shortenUrl(rawUrl: string | null | undefined, maxLength = 46): string {
  if (!rawUrl) {
    return "（无 URL）"
  }

  let summary = rawUrl

  try {
    const parsed = new URL(rawUrl)
    const segments = parsed.pathname.split("/").filter(Boolean)
    const lastSegment = segments[segments.length - 1]

    summary = lastSegment
      ? `${parsed.hostname}/…/${lastSegment}${parsed.search ? parsed.search.slice(0, 12) + "…" : ""}`
      : parsed.hostname
  } catch {
    // 解析失败就原样截断
  }

  if (summary.length > maxLength) {
    summary = summary.slice(0, maxLength - 1) + "…"
  }

  return summary
}
