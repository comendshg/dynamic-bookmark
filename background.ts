/// <reference types="chrome" />

// 会话存储中的键名，用于保存标签页相关的状态映射
const SESSION_KEY = "tabStateMap"

// 持久化存储中的键名，用于保存需要接管的收藏夹名称列表
const MANAGED_FOLDER_TITLES_KEY = "managedFolderTitles"

// 每个标签页需要保存的信息：最后访问的 URL 和标题
type TabState = {
  // 最近一次记录到的 URL（用于在标签关闭时更新书签）
  lastUrl?: string
  // 最近一次记录到的标题（用于在标签关闭时同步更新书签标题）
  lastTitle?: string
}

// 使用标签 id（string）作为 key 的映射表
type TabStateMap = Record<string, TabState>

type MatchProfile =
  | {
      type: "bilibili"
      bvId: string
    }
  | {
      type: "course"
      prefix: string
    }

// 优先使用 session 存储（如果可用），否则降级到 local
const storageArea = chrome.storage.session ?? chrome.storage.local

// 收藏夹接管配置需要跨浏览器重启保存，因此固定使用 local
const persistentStorageArea = chrome.storage.local

// 从 storage 中读取整个映射表，若不存在则返回空对象
async function getTabStateMap(): Promise<TabStateMap> {
  const result = await storageArea.get(SESSION_KEY)
  return (result[SESSION_KEY] as TabStateMap) ?? {}
}

// 将映射表写回 storage
async function setTabStateMap(map: TabStateMap): Promise<void> {
  await storageArea.set({ [SESSION_KEY]: map })
}

function normalizeFolderTitle(title: string): string {
  return title.trim()
}

function normalizeManagedFolderTitles(titles: string[]): string[] {
  const uniqueTitles = new Set<string>()

  for (const title of titles) {
    const normalizedTitle = normalizeFolderTitle(title)

    if (normalizedTitle) {
      uniqueTitles.add(normalizedTitle)
    }
  }

  return [...uniqueTitles]
}

async function getManagedFolderTitles(): Promise<string[]> {
  const result = await persistentStorageArea.get(MANAGED_FOLDER_TITLES_KEY)
  const storedTitles = result[MANAGED_FOLDER_TITLES_KEY]

  if (Array.isArray(storedTitles)) {
    return normalizeManagedFolderTitles(storedTitles.filter((title): title is string => typeof title === "string"))
  }

  return []
}

async function setManagedFolderTitles(titles: string[]): Promise<void> {
  await persistentStorageArea.set({
    [MANAGED_FOLDER_TITLES_KEY]: normalizeManagedFolderTitles(titles)
  })
}

async function ensureManagedFolderSettings(): Promise<void> {
  const result = await persistentStorageArea.get(MANAGED_FOLDER_TITLES_KEY)

  if (result[MANAGED_FOLDER_TITLES_KEY] === undefined) {
    await setManagedFolderTitles([])
  }
}

// 简单判断是否为 http(s) 类型的 URL
function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://")
}

// 去掉 hash，保留 URL 的主体部分，便于进行稳定比较
function normalizeUrl(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url)
    parsedUrl.hash = ""
    return parsedUrl.toString()
  } catch {
    return undefined
  }
}

// 从 B 站视频 URL 中提取 BV 号
function extractBilibiliBvId(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url)
    const match = parsedUrl.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)
    return match?.[1].toUpperCase()
  } catch {
    return undefined
  }
}

// 文档/博客类网站的“课程根前缀”匹配键：origin + 第一级路径分段
function extractCoursePrefix(url: string): string | undefined {
  try {
    const parsedUrl = new URL(url)
    const firstPathSegment = parsedUrl.pathname.split("/").filter(Boolean)[0]

    if (!firstPathSegment) {
      return undefined
    }

    // 例如：https://beatai.org/rust-course/advance/unsafe/intro
    // 会被归一化为：https://beatai.org/rust-course/
    // 这样同一门课程下更深层的页面都能被视为同一个“进度桶”。
    return `${parsedUrl.origin}/${firstPathSegment}/`
  } catch {
    return undefined
  }
}

function getMatchProfile(url: string): MatchProfile | undefined {
  const bilibiliBvId = extractBilibiliBvId(url)

  // B 站视频优先走 BV 号匹配，避免 ?p=3、?t=123 这类参数变化干扰同一个视频的进度更新。
  if (bilibiliBvId) {
    return {
      type: "bilibili",
      bvId: bilibiliBvId
    }
  }

  const prefix = extractCoursePrefix(url)

  if (prefix) {
    return {
      type: "course",
      prefix
    }
  }

  return undefined
}

async function getBookmarkBarRootNode(): Promise<chrome.bookmarks.BookmarkTreeNode | undefined> {
  const tree = await chrome.bookmarks.getTree()
  const rootNode = tree[0]
  const directChildren = rootNode?.children ?? []

  // Chrome 的书签栏根节点通常是 id = "1"；如果未来环境不同，则退回到第一个顶层文件夹。
  return directChildren.find((node) => node.id === "1") ?? directChildren[0]
}

async function findFolderNodesByTitles(titles: string[]): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  // 保持向后兼容：此函数仍然存在，但更通用的查找器在下方实现。
  const normalizedTitles = new Set(normalizeManagedFolderTitles(titles))

  if (normalizedTitles.size === 0) {
    return []
  }

  const bookmarkBarRoot = await getBookmarkBarRootNode()

  if (!bookmarkBarRoot) {
    return []
  }

  const matchedNodes: chrome.bookmarks.BookmarkTreeNode[] = []
  const stack = [...(bookmarkBarRoot.children ?? [])]

  while (stack.length > 0) {
    const node = stack.pop()

    if (!node) continue

    if (!node.url && normalizedTitles.has(node.title)) {
      matchedNodes.push(node)
    }

    if (node.children?.length) stack.push(...node.children)
  }

  return matchedNodes
}

// 支持按 "父 / 子 / 子" 路径查找节点，也支持传统只按标题匹配的标识符。
async function findFolderNodesByIdentifiers(identifiers: string[]): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  const bookmarkBarRoot = await getBookmarkBarRootNode()

  if (!bookmarkBarRoot || identifiers.length === 0) return []

  const matchedById = new Map<string, chrome.bookmarks.BookmarkTreeNode>()

  for (const raw of identifiers) {
    if (typeof raw !== "string") continue

    const id = raw.trim()
    if (!id) continue

    if (id.includes("/")) {
      const parts = id.split("/").map((s) => s.trim()).filter(Boolean)
      if (parts.length === 0) continue

      // 从书签栏一级开始匹配
      let currentNodes = bookmarkBarRoot.children ?? []
      let foundNode: chrome.bookmarks.BookmarkTreeNode | undefined

      for (const part of parts) {
        foundNode = (currentNodes.find((n) => n.title === part && !n.url))

        if (!foundNode) break

        currentNodes = foundNode.children ?? []
      }

      if (foundNode) matchedById.set(foundNode.id, foundNode)
    } else {
      // legacy: match by title anywhere
      const stack = [...(bookmarkBarRoot.children ?? [])]

      while (stack.length > 0) {
        const node = stack.pop()

        if (!node) continue

        if (!node.url && node.title === id) matchedById.set(node.id, node)

        if (node.children?.length) stack.push(...node.children)
      }
    }
  }

  return [...matchedById.values()]
}

async function ensureMonitorFolderNode(): Promise<chrome.bookmarks.BookmarkTreeNode | undefined> {
  return undefined
}

async function collectBookmarksUnderFolder(folderNode: chrome.bookmarks.BookmarkTreeNode): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  const bookmarks: chrome.bookmarks.BookmarkTreeNode[] = []
  const stack = [...(folderNode.children ?? [])]

  while (stack.length > 0) {
    const node = stack.pop()

    if (!node) {
      continue
    }

    if (node.url) {
      bookmarks.push(node)
    }

    if (node.children?.length) {
      stack.push(...node.children)
    }
  }

  return bookmarks
}

async function collectBookmarksUnderManagedFolders(): Promise<chrome.bookmarks.BookmarkTreeNode[]> {
  const managedFolderTitles = await getManagedFolderTitles()

  if (managedFolderTitles.length === 0) {
    return []
  }

  const folderNodes = await findFolderNodesByIdentifiers(managedFolderTitles)
  const bookmarksById = new Map<string, chrome.bookmarks.BookmarkTreeNode>()

  for (const folderNode of folderNodes) {
    const bookmarks = await collectBookmarksUnderFolder(folderNode)

    for (const bookmark of bookmarks) {
      bookmarksById.set(bookmark.id, bookmark)
    }
  }

  return [...bookmarksById.values()]
}

function isBookmarkMatch(bookmarkUrl: string, profile: MatchProfile): boolean {
  if (profile.type === "bilibili") {
    // 详细说明：
    // B 站的视频进度不应受 p 分集、t 时间戳、spm 等查询参数影响。
    // 这里仅提取 /video/ 后面的 BV 号作为唯一匹配键。
    // 只要收藏夹中某个书签的 BV 号一致，就视为同一个视频的进度更新。
    return extractBilibiliBvId(bookmarkUrl) === profile.bvId
  }

  // 详细说明：
  // 文档/博客类页面按“域名 + 第一级路径分段”来做匹配。
  // 例如：
  // - 关闭页：beatai.org/rust-course/advance/unsafe/intro
  // - 书签页：beatai.org/rust-course/basic-practice/stderr
  // 两者都会被归一化成 beatai.org/rust-course/，因此可以被视为同一课程的进度更新。
  // 这类规则的目标不是逐字节对齐 URL，而是把同一课程/同一专题下的不同章节归入同一个“更新桶”。
  return extractCoursePrefix(bookmarkUrl) === profile.prefix
}

async function findBookmarkToUpdate(sourceUrl: string): Promise<chrome.bookmarks.BookmarkTreeNode | undefined> {
  const profile = getMatchProfile(sourceUrl)

  if (!profile) {
    return undefined
  }

  const candidateBookmarks = await collectBookmarksUnderManagedFolders()
  const normalizedSourceUrl = normalizeUrl(sourceUrl)

  if (profile.type === "bilibili") {
    // 先尝试“同 BV 号 + 同 URL 主体”的精确命中，再退回到 BV 号命中。
    return (
      candidateBookmarks.find((bookmark) => normalizeUrl(bookmark.url ?? "") === normalizedSourceUrl) ??
      candidateBookmarks.find((bookmark) => isBookmarkMatch(bookmark.url ?? "", profile))
    )
  }

  // 文档类站点同样优先匹配完全一致的 URL（仅去掉 hash 后比较），
  // 如果没有找到完全一致的页面，再使用“域名 + 第一级路径分段”规则进行覆盖更新。
  return (
    candidateBookmarks.find((bookmark) => normalizeUrl(bookmark.url ?? "") === normalizedSourceUrl) ??
    candidateBookmarks.find((bookmark) => isBookmarkMatch(bookmark.url ?? "", profile))
  )
}

// 当标签页信息发生变化时，记录最新 URL 和标题，供关闭时做书签覆盖
async function handleTabUpdate(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): Promise<void> {
  const nextUrl = changeInfo.url ?? tab.url

  if (nextUrl && !isHttpUrl(nextUrl)) {
    // 一旦标签页切到非网页协议，就清除缓存状态，避免关闭标签页时误用旧网页 URL 覆盖书签。
    const map = await getTabStateMap()
    delete map[String(tabId)]
    await setTabStateMap(map)
    return
  }

  const nextTitle = changeInfo.title ?? tab.title

  if (!nextUrl && !nextTitle) {
    return
  }

  const map = await getTabStateMap()
  const key = String(tabId)
  const state = map[key] ?? {}

  if (nextUrl && isHttpUrl(nextUrl)) {
    state.lastUrl = nextUrl
  }

  if (nextTitle) {
    state.lastTitle = nextTitle
  }

  map[key] = state
  await setTabStateMap(map)
}

// 当标签页关闭时调用：根据最后记录的 URL 在监控文件夹中查找匹配书签并覆盖更新
async function handleTabClosed(tabId: number): Promise<void> {
  const map = await getTabStateMap()
  const key = String(tabId)
  const state = map[key]

  console.log(`[Dynamic Bookmark] Tab ${tabId} closed`)

  if (!state) {
    console.log(`[Dynamic Bookmark] No state found for tab ${tabId}`)
    return
  }

  // 如果找到了最近访问的网页 URL，则按双轨规则查找需要覆盖的书签。
  if (state.lastUrl) {
    try {
      const targetBookmark = await findBookmarkToUpdate(state.lastUrl)

      if (targetBookmark) {
        console.log(`[Dynamic Bookmark] Updating bookmark ${targetBookmark.id} with URL: ${state.lastUrl}`)

        // 关闭标签页后，仅更新书签的 URL，保持原书签标题不变。
        const updatePayload: chrome.bookmarks.BookmarkChangesArg = { url: state.lastUrl }

        await chrome.bookmarks.update(targetBookmark.id, updatePayload)
        console.log(`[Dynamic Bookmark] Successfully updated bookmark ${targetBookmark.id}`)
      } else {
        console.log(`[Dynamic Bookmark] No matching bookmark found for URL: ${state.lastUrl}`)
      }
    } catch (error) {
      console.error(`[Dynamic Bookmark] Failed to update bookmark for tab ${tabId}:`, error)
    }
  }

  // 从映射表中移除该标签的状态并保存
  delete map[key]
  await setTabStateMap(map)
}

// 扩展启动时立即确保监控文件夹存在，避免第一次关闭标签页时才临时创建目录。
async function initializeMonitorFolder(): Promise<void> {
  await ensureManagedFolderSettings()
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const nextMessage = message as {
    type?: string
    folderTitles?: unknown
  }

  if (nextMessage.type !== "set-managed-folders") {
    return
  }

  void (async () => {
    const folderTitles = Array.isArray(nextMessage.folderTitles)
      ? nextMessage.folderTitles.filter((title): title is string => typeof title === "string")
      : []

    await setManagedFolderTitles(folderTitles)
    await ensureMonitorFolderNode()
    sendResponse({ ok: true, folderTitles: normalizeManagedFolderTitles(folderTitles) })
  })().catch((error) => {
    console.error("[Dynamic Bookmark] Failed to update managed folders:", error)
    sendResponse({ ok: false })
  })

  return true
})

chrome.runtime.onInstalled.addListener(() => {
  void initializeMonitorFolder()
})

chrome.runtime.onStartup.addListener(() => {
  void initializeMonitorFolder()
})

void initializeMonitorFolder()

// 监听标签页 URL 和标题更新事件，触发时调用 handleTabUpdate
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) {
    return
  }

  void handleTabUpdate(tabId, changeInfo, tab)
})

// 监听标签页移除事件，触发时调用 handleTabClosed
chrome.tabs.onRemoved.addListener((tabId) => {
  void handleTabClosed(tabId)
})
