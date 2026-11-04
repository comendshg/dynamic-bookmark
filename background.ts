/// <reference types="chrome" />

import {
  appendOperationLog,
  createBookmarkUrlSnapshot,
  createManagedFoldersSnapshot,
  findFolderNodesByIdentifiers,
  findFolderNodesByIds,
  getExtensionEnabled,
  getManagedFolderIds,
  getManagedFolderIdsState,
  getManagedFolderTitles,
  normalizeManagedFolderIds,
  resolveFolderPaths,
  serializeError,
  setManagedFolderIds,
  type OperationLogEntry
} from "./logger"

import { rollbackOperationLogEntry } from "./historyRollback"

// 会话存储中的键名，用于保存标签页相关的状态映射
const SESSION_KEY = "tabStateMap"

// 每个标签页需要保存的信息：最后访问的 URL 和标题
type TabState = {
  // 最近一次记录到的 URL（用于在标签关闭或离开页面时更新书签）
  lastUrl?: string
  // 最近一次记录到的标题（用于在标签关闭时同步更新书签标题）
  lastTitle?: string
  // 最近一次已成功提交到书签的 URL（去 hash 后的规范化形式），
  // 用于避免关闭标签页时把同一个地址重复写入书签和日志。
  lastCommittedNormalizedUrl?: string
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

// 从 storage 中读取整个映射表，若不存在则返回空对象
async function getTabStateMap(): Promise<TabStateMap> {
  const result = await storageArea.get(SESSION_KEY)
  return (result[SESSION_KEY] as TabStateMap) ?? {}
}

// 将映射表写回 storage
async function setTabStateMap(map: TabStateMap): Promise<void> {
  await storageArea.set({ [SESSION_KEY]: map })
}

// 启动时确保托管配置存在，并把 legacy 的路径字符串配置一次性迁移为文件夹 id。
// id 是 Chrome 书签树的稳定标识：文件夹改名、移动后仍然有效，
// 而路径字符串在改名/移动后会静默失配，导致接管悄悄失效。
async function ensureManagedFolderSettings(): Promise<void> {
  const idsState = await getManagedFolderIdsState()

  if (idsState.exists) {
    return
  }

  const legacyTitles = await getManagedFolderTitles()
  const folderNodes = await findFolderNodesByIdentifiers(legacyTitles)

  await setManagedFolderIds(folderNodes.map((node) => node.id))
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
    // BV 号是 base58 编码、大小写敏感，不能做大小写归一化，
    // 否则仅大小写不同的两个视频会被误判为同一个进度桶。
    return match?.[1]
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

// 判断两个 URL 是否属于同一个"进度桶"（同一 BV 号，或同一课程前缀）。
// 在同一门课程 / 同一个视频内连续翻页时不应触发中间提交：
// 等真正离开该桶或关闭标签页时，一次性写入最终位置，
// 避免"看一次视频 / 读一次课程"在日志里产生多条中间记录。
function isSameMatchBucket(urlA: string, urlB: string): boolean {
  const profileA = getMatchProfile(urlA)
  const profileB = getMatchProfile(urlB)

  if (!profileA || !profileB || profileA.type !== profileB.type) {
    return false
  }

  if (profileA.type === "bilibili" && profileB.type === "bilibili") {
    return profileA.bvId === profileB.bvId
  }

  if (profileA.type === "course" && profileB.type === "course") {
    return profileA.prefix === profileB.prefix
  }

  return false
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
  const idsState = await getManagedFolderIdsState()
  let folderIds = idsState.ids

  if (!idsState.exists) {
    // ids 键尚未写入（理论上启动时已迁移，这里做防御性兜底）：
    // 回退到 legacy 路径字符串匹配。
    const legacyTitles = await getManagedFolderTitles()
    const legacyNodes = await findFolderNodesByIdentifiers(legacyTitles)
    folderIds = legacyNodes.map((node) => node.id)
  }

  if (folderIds.length === 0) {
    return []
  }

  const folderNodes = await findFolderNodesByIds(folderIds)
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

async function commitBookmarkProgress(sourceUrl: string): Promise<boolean> {
  let targetBookmark: chrome.bookmarks.BookmarkTreeNode | undefined

  try {
    // 总开关关闭时不更新任何书签：用户明确要求暂停时静默跳过，
    // 既不写书签也不写日志。
    if (!(await getExtensionEnabled())) {
      console.log("[Dynamic Bookmark] Paused, skip bookmark update")
      return false
    }

    targetBookmark = await findBookmarkToUpdate(sourceUrl)

    if (!targetBookmark) {
      console.log(`[Dynamic Bookmark] No matching bookmark found for URL: ${sourceUrl}`)
      return false
    }

    console.log(`[Dynamic Bookmark] Updating bookmark ${targetBookmark.id} with URL: ${sourceUrl}`)
    const beforeSnapshot = createBookmarkUrlSnapshot(targetBookmark)
    const afterSnapshot = createBookmarkUrlSnapshot({ ...targetBookmark, url: sourceUrl })

    // 若书签当前 URL（去 hash 后）已经与要写入的地址一致，跳过这次更新，
    // 避免无意义的 bookmarks.update 调用和内容重复的日志。
    const currentNormalizedUrl = normalizeUrl(targetBookmark.url ?? "")
    const nextNormalizedUrl = normalizeUrl(sourceUrl)

    if (currentNormalizedUrl && nextNormalizedUrl && currentNormalizedUrl === nextNormalizedUrl) {
      console.log(`[Dynamic Bookmark] Skip update because bookmark ${targetBookmark.id} is already synced`)
      return true
    }

    // 只更新 URL，保持原书签标题不变。
    await chrome.bookmarks.update(targetBookmark.id, { url: sourceUrl })

    await appendOperationLog({
      timestamp: Date.now(),
      operationType: "bookmark-url-update",
      before: beforeSnapshot,
      after: afterSnapshot,
      error: null,
      remark: "书签 URL 更新"
    })

    console.log(`[Dynamic Bookmark] Successfully updated bookmark ${targetBookmark.id}`)
    return true
  } catch (error) {
    if (targetBookmark) {
      try {
        await appendOperationLog({
          timestamp: Date.now(),
          operationType: "bookmark-url-update",
          before: createBookmarkUrlSnapshot(targetBookmark),
          after: createBookmarkUrlSnapshot({ ...targetBookmark, url: sourceUrl }),
          error: serializeError(error),
          remark: "书签 URL 更新"
        })
      } catch (logError) {
        console.error("[Dynamic Bookmark] Failed to record bookmark update error log:", logError)
      }
    }

    console.error(`[Dynamic Bookmark] Failed to update bookmark for URL: ${sourceUrl}`, error)
    return false
  }
}

// 把同一标签页的事件处理串行化：onUpdated / onRemoved 可能并发触发，
// 若不排队，多个异步流程会对 storage 中的映射表做并发读改写，
// 导致状态丢失、已删除状态"复活"、或用旧 URL 误更新书签。
const tabOperationQueues = new Map<number, Promise<unknown>>()

function enqueueTabOperation<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
  const previous = tabOperationQueues.get(tabId) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(operation).finally(() => {
    if (tabOperationQueues.get(tabId) === next) {
      tabOperationQueues.delete(tabId)
    }
  })

  tabOperationQueues.set(tabId, next)
  return next
}

async function clearTabState(tabId: number): Promise<void> {
  const map = await getTabStateMap()
  delete map[String(tabId)]
  await setTabStateMap(map)
}

// 当标签页信息发生变化时，记录最新 URL 和标题，供关闭时做书签覆盖
async function handleTabUpdate(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab): Promise<void> {
  // 暂停期间不记录任何浏览痕迹（不写会话状态，自然也不会在关闭时提交）。
  if (!(await getExtensionEnabled())) {
    return
  }

  const key = String(tabId)
  const nextTitle = changeInfo.title ?? tab.title
  const map = await getTabStateMap()
  const state = map[key] ?? {}
  const previousUrl = state.lastUrl

  if (changeInfo.url && !isHttpUrl(changeInfo.url)) {
    // 一旦标签页切到非网页协议，先提交离开前的学习页，再清除缓存状态。
    if (previousUrl) {
      const committed = await commitBookmarkProgress(previousUrl)

      if (committed) {
        state.lastCommittedNormalizedUrl = normalizeUrl(previousUrl)
      }
    }

    await clearTabState(tabId)
    return
  }

  if (changeInfo.url) {
    const normalizedPreviousUrl = previousUrl ? normalizeUrl(previousUrl) : undefined
    const normalizedNextUrl = normalizeUrl(changeInfo.url)

    if (
      previousUrl &&
      normalizedPreviousUrl &&
      normalizedNextUrl &&
      normalizedPreviousUrl !== normalizedNextUrl &&
      // 同一进度桶内的连续翻页不算"离开"，不做中间提交，
      // 避免一次阅读产生多条日志（详见 isSameMatchBucket 注释）。
      !isSameMatchBucket(previousUrl, changeInfo.url)
    ) {
      const committed = await commitBookmarkProgress(previousUrl)

      if (committed) {
        state.lastCommittedNormalizedUrl = normalizedPreviousUrl
      }
    }

    if (isHttpUrl(changeInfo.url) && getMatchProfile(changeInfo.url)) {
      state.lastUrl = changeInfo.url
    } else {
      await clearTabState(tabId)
      return
    }
  }

  if (nextTitle) {
    state.lastTitle = nextTitle
  }

  if (!state.lastUrl && !state.lastTitle) {
    await clearTabState(tabId)
    return
  }

  map[key] = state
  await setTabStateMap(map)
}

// 当标签页关闭时调用：根据最后记录的 URL 在监控文件夹中查找匹配书签并覆盖更新
async function handleTabClosed(tabId: number): Promise<void> {
  const map = await getTabStateMap()
  const key = String(tabId)

  // 暂停期间不提交，顺手清掉暂停前可能残留的状态，避免恢复后拿着旧 URL 误更新。
  if (!(await getExtensionEnabled())) {
    if (key in map) {
      delete map[key]
      await setTabStateMap(map)
    }

    return
  }

  const state = map[key]

  console.log(`[Dynamic Bookmark] Tab ${tabId} closed`)

  if (!state?.lastUrl) {
    console.log(`[Dynamic Bookmark] No state found for tab ${tabId}`)
    return
  }

  const normalizedLastUrl = normalizeUrl(state.lastUrl)

  // 如果这个 URL 在离开页面时已经提交过（例如切换 URL 时触发过一次），
  // 关闭标签页时不再重复更新书签，也不再写一条内容相同的日志。
  if (normalizedLastUrl && state.lastCommittedNormalizedUrl === normalizedLastUrl) {
    delete map[key]
    await setTabStateMap(map)
    return
  }

  await commitBookmarkProgress(state.lastUrl)

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
    folderIds?: unknown
    folderTitles?: unknown
    entry?: unknown
  }

  if (nextMessage.type === "rollback-operation-log") {
    void (async () => {
      const entry = nextMessage.entry as OperationLogEntry | undefined

      if (!entry) {
        throw new Error("missing rollback entry")
      }

      const response = await rollbackOperationLogEntry(entry)
      sendResponse(response)
    })().catch((error) => {
      console.error("[Dynamic Bookmark] Failed to rollback log entry:", error)
      sendResponse({ ok: false, message: serializeError(error) })
    })

    return true
  }

  if (nextMessage.type !== "set-managed-folders") {
    return
  }

  void (async () => {
    const beforeIds = await getManagedFolderIds()

    // 新协议：直接传文件夹 id 数组。
    // 兼容旧协议：若只收到路径/标题字符串，先解析为 id。
    let folderIds: string[]

    if (Array.isArray(nextMessage.folderIds)) {
      folderIds = nextMessage.folderIds.filter((id): id is string => typeof id === "string")
    } else if (Array.isArray(nextMessage.folderTitles)) {
      const titles = nextMessage.folderTitles.filter((title): title is string => typeof title === "string")
      folderIds = (await findFolderNodesByIdentifiers(titles)).map((node) => node.id)
    } else {
      folderIds = []
    }

    const normalizedIds = normalizeManagedFolderIds(folderIds)

    await setManagedFolderIds(normalizedIds)

    // 日志快照仍然存人类可读的路径，方便在日志页直接阅读；
    // 回退时再把路径解析回 id（见 historyRollback.ts）。
    const beforePaths = await resolveFolderPaths(beforeIds)
    const afterPaths = await resolveFolderPaths(normalizedIds)

    await appendOperationLog({
      timestamp: Date.now(),
      operationType: "managed-folders-update",
      before: createManagedFoldersSnapshot(beforePaths),
      after: createManagedFoldersSnapshot(afterPaths),
      error: null,
      remark: "配置变更"
    })

    sendResponse({ ok: true, folderIds: normalizedIds })
  })().catch((error) => {
    console.error("[Dynamic Bookmark] Failed to update managed folders:", error)

    void (async () => {
      try {
        const beforeIds = await getManagedFolderIds()
        const beforePaths = await resolveFolderPaths(beforeIds)

        await appendOperationLog({
          timestamp: Date.now(),
          operationType: "managed-folders-update",
          before: createManagedFoldersSnapshot(beforePaths),
          after: createManagedFoldersSnapshot([]),
          error: serializeError(error),
          remark: "配置变更"
        })
      } catch (logError) {
        console.error("[Dynamic Bookmark] Failed to record managed folder error log:", logError)
      }
    })().finally(() => {
      sendResponse({ ok: false })
    })
  })

  return true
})

chrome.runtime.onInstalled.addListener(() => {
  void initializeMonitorFolder()
})

chrome.runtime.onStartup.addListener(() => {
  // 若环境不支持 session 存储（已降级到 local），映射表会跨浏览器会话残留；
  // 浏览器重启后 tabId 可能被复用，导致用旧 URL 误更新书签，因此启动时清空。
  if (!chrome.storage.session) {
    void storageArea.remove(SESSION_KEY)
  }

  void initializeMonitorFolder()
})

void initializeMonitorFolder()

// 监听标签页 URL 和标题更新事件，触发时调用 handleTabUpdate
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) {
    return
  }

  void enqueueTabOperation(tabId, () => handleTabUpdate(tabId, changeInfo, tab))
})

// 监听标签页移除事件，触发时调用 handleTabClosed
chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueueTabOperation(tabId, () => handleTabClosed(tabId))
})
