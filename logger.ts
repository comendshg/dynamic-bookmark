const persistentStorageArea = chrome.storage.local

export const MANAGED_FOLDER_TITLES_KEY = "managedFolderTitles"
export const MANAGED_FOLDER_IDS_KEY = "managedFolderIds"
export const BOOKMARK_OPERATION_LOGS_KEY = "bookmarkOperationLogs"
export const EXTENSION_ENABLED_KEY = "dynamicBookmarkEnabled"
export const MAX_OPERATION_LOGS = 100

export const FOLDER_PATH_SEPARATOR = " / "

type PlainObject = Record<string, unknown>

export type ManagedFoldersSnapshot = {
  snapshotType: "managed-folders"
  folderTitles: string[]
}

export type BookmarkUrlSnapshot = {
  snapshotType: "bookmark-url"
  bookmarkId: string
  bookmarkTitle: string
  bookmarkUrl: string | null
  sourceUrl?: string
}

export type OperationSnapshot = ManagedFoldersSnapshot | BookmarkUrlSnapshot

export type OperationLogEntry = {
  timestamp: number
  operationType: string
  before: OperationSnapshot
  after: OperationSnapshot
  error: string | null
  remark: string
}

function isPlainObject(value: unknown): value is PlainObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalizeFolderTitle(title: string): string {
  return title.trim()
}

export function normalizeManagedFolderTitles(titles: string[]): string[] {
  const uniqueTitles = new Set<string>()

  for (const title of titles) {
    const normalizedTitle = normalizeFolderTitle(title)

    if (normalizedTitle) {
      uniqueTitles.add(normalizedTitle)
    }
  }

  return [...uniqueTitles]
}

export function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }

  if (typeof error === "string") {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function isManagedFoldersSnapshot(value: unknown): value is ManagedFoldersSnapshot {
  if (!isPlainObject(value) || value.snapshotType !== "managed-folders" || !Array.isArray(value.folderTitles)) {
    return false
  }

  return value.folderTitles.every((title) => typeof title === "string")
}

function isBookmarkUrlSnapshot(value: unknown): value is BookmarkUrlSnapshot {
  if (!isPlainObject(value) || value.snapshotType !== "bookmark-url") {
    return false
  }

  return (
    typeof value.bookmarkId === "string" &&
    typeof value.bookmarkTitle === "string" &&
    (value.bookmarkUrl === null || typeof value.bookmarkUrl === "string") &&
    (value.sourceUrl === undefined || typeof value.sourceUrl === "string")
  )
}

function isOperationSnapshot(value: unknown): value is OperationSnapshot {
  return isManagedFoldersSnapshot(value) || isBookmarkUrlSnapshot(value)
}

export function isOperationLogEntry(value: unknown): value is OperationLogEntry {
  if (!isPlainObject(value)) {
    return false
  }

  return (
    typeof value.timestamp === "number" &&
    typeof value.operationType === "string" &&
    isOperationSnapshot(value.before) &&
    isOperationSnapshot(value.after) &&
    (value.error === null || typeof value.error === "string") &&
    typeof value.remark === "string"
  )
}

export function createManagedFoldersSnapshot(folderTitles: string[]): ManagedFoldersSnapshot {
  return {
    snapshotType: "managed-folders",
    folderTitles: normalizeManagedFolderTitles(folderTitles)
  }
}

export function createBookmarkUrlSnapshot(
  bookmark: chrome.bookmarks.BookmarkTreeNode,
  bookmarkUrl: string | null = bookmark.url ?? null
): BookmarkUrlSnapshot {
  return {
    snapshotType: "bookmark-url",
    bookmarkId: bookmark.id,
    bookmarkTitle: bookmark.title,
    bookmarkUrl,
    sourceUrl: bookmark.url ?? undefined
  }
}

export async function getManagedFolderTitles(): Promise<string[]> {
  const result = await persistentStorageArea.get(MANAGED_FOLDER_TITLES_KEY)
  const storedTitles = result[MANAGED_FOLDER_TITLES_KEY]

  if (Array.isArray(storedTitles)) {
    return normalizeManagedFolderTitles(storedTitles.filter((title): title is string => typeof title === "string"))
  }

  return []
}

export async function setManagedFolderTitles(titles: string[]): Promise<void> {
  await persistentStorageArea.set({
    [MANAGED_FOLDER_TITLES_KEY]: normalizeManagedFolderTitles(titles)
  })
}

export function normalizeManagedFolderIds(ids: string[]): string[] {
  const uniqueIds = new Set<string>()

  for (const id of ids) {
    const normalizedId = typeof id === "string" ? id.trim() : ""

    if (normalizedId) {
      uniqueIds.add(normalizedId)
    }
  }

  return [...uniqueIds]
}

// 区分「还没设置过」和「设置为空」：
// 前者需要走一次 legacy titles -> ids 的迁移，后者表示用户明确不接管任何文件夹。
export type ManagedFolderIdsState = {
  ids: string[]
  exists: boolean
}

export async function getManagedFolderIdsState(): Promise<ManagedFolderIdsState> {
  const result = await persistentStorageArea.get(MANAGED_FOLDER_IDS_KEY)
  const storedIds = result[MANAGED_FOLDER_IDS_KEY]

  if (!Array.isArray(storedIds)) {
    return { ids: [], exists: false }
  }

  return {
    ids: normalizeManagedFolderIds(storedIds.filter((id): id is string => typeof id === "string")),
    exists: true
  }
}

export async function getManagedFolderIds(): Promise<string[]> {
  return (await getManagedFolderIdsState()).ids
}

export async function setManagedFolderIds(ids: string[]): Promise<void> {
  await persistentStorageArea.set({
    [MANAGED_FOLDER_IDS_KEY]: normalizeManagedFolderIds(ids)
  })
}

// 总开关：默认开启。关闭后后台不再更新任何书签（手动撤销仍可用）。
export async function getExtensionEnabled(): Promise<boolean> {
  const result = await persistentStorageArea.get(EXTENSION_ENABLED_KEY)
  const stored = result[EXTENSION_ENABLED_KEY]

  return typeof stored === "boolean" ? stored : true
}

export async function setExtensionEnabled(enabled: boolean): Promise<void> {
  await persistentStorageArea.set({
    [EXTENSION_ENABLED_KEY]: !!enabled
  })
}

type ChromeBookmarkNode = chrome.bookmarks.BookmarkTreeNode

async function getBookmarkTreeRoots(): Promise<ChromeBookmarkNode[]> {
  const tree = await chrome.bookmarks.getTree()
  return tree[0]?.children ?? []
}

// Chrome 书签栏根节点（id = "1"），找不到时退回第一个顶层文件夹。
async function getBookmarkBarRootNode(): Promise<ChromeBookmarkNode | undefined> {
  const roots = await getBookmarkTreeRoots()
  return roots.find((node) => node.id === "1") ?? roots[0]
}

// 遍历整棵书签树，建立 id -> 节点 的映射（含所有位置的书签，不限于书签栏）。
export async function buildFolderNodesById(): Promise<Map<string, ChromeBookmarkNode>> {
  const map = new Map<string, ChromeBookmarkNode>()
  const stack = await getBookmarkTreeRoots()

  while (stack.length > 0) {
    const node = stack.pop()

    if (!node) continue

    if (!node.url) {
      map.set(node.id, node)
    }

    if (node.children?.length) {
      stack.push(...node.children)
    }
  }

  return map
}

// 按稳定 id 查找文件夹节点。id 不会因为改名、移动而变化，
// 因此基于 id 的配置比基于路径字符串的配置可靠得多。
export async function findFolderNodesByIds(ids: string[]): Promise<ChromeBookmarkNode[]> {
  if (ids.length === 0) {
    return []
  }

  const nodesById = await buildFolderNodesById()

  return ids
    .map((id) => nodesById.get(id))
    .filter((node): node is ChromeBookmarkNode => !!node && !node.url)
}

// 遍历整棵树，建立 文件夹 id -> 展示路径（"A / B / C"） 的映射。
export async function buildFolderPathsById(): Promise<Map<string, string>> {
  const pathsById = new Map<string, string>()

  function walk(nodes: ChromeBookmarkNode[], parentTitles: string[]) {
    for (const node of nodes) {
      if (node.url) continue

      const titles = [...parentTitles, node.title]
      pathsById.set(node.id, titles.join(FOLDER_PATH_SEPARATOR))

      if (node.children?.length) {
        walk(node.children, titles)
      }
    }
  }

  const roots = await getBookmarkTreeRoots()
  walk(roots, [])

  return pathsById
}

// 把一组文件夹 id 解析为人类可读的路径（用于日志展示）。
export async function resolveFolderPaths(ids: string[]): Promise<string[]> {
  if (ids.length === 0) {
    return []
  }

  const pathsById = await buildFolderPathsById()

  return ids.map((id) => pathsById.get(id)).filter((path): path is string => !!path)
}

// 支持按 "父 / 子 / 子" 路径查找节点，也支持传统只按标题匹配的标识符。
// 仅用于 legacy 配置迁移和配置回退（历史日志里存的是路径字符串）。
export async function findFolderNodesByIdentifiers(identifiers: string[]): Promise<ChromeBookmarkNode[]> {
  const bookmarkBarRoot = await getBookmarkBarRootNode()

  if (!bookmarkBarRoot || identifiers.length === 0) return []

  const matchedById = new Map<string, ChromeBookmarkNode>()

  for (const raw of identifiers) {
    if (typeof raw !== "string") continue

    const id = raw.trim()
    if (!id) continue

    if (id.includes("/")) {
      const parts = id.split("/").map((s) => s.trim()).filter(Boolean)
      if (parts.length === 0) continue

      // 从书签栏一级开始匹配
      let currentNodes = bookmarkBarRoot.children ?? []
      let foundNode: ChromeBookmarkNode | undefined

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

export async function getOperationLogs(): Promise<OperationLogEntry[]> {
  const result = await persistentStorageArea.get(BOOKMARK_OPERATION_LOGS_KEY)
  const storedLogs = result[BOOKMARK_OPERATION_LOGS_KEY]

  if (!Array.isArray(storedLogs)) {
    return []
  }

  return storedLogs.filter(isOperationLogEntry)
}

export async function setOperationLogs(logs: OperationLogEntry[]): Promise<void> {
  await persistentStorageArea.set({
    [BOOKMARK_OPERATION_LOGS_KEY]: logs.slice(-MAX_OPERATION_LOGS)
  })
}

export async function appendOperationLog(entry: OperationLogEntry): Promise<void> {
  const currentLogs = await getOperationLogs()
  currentLogs.push(entry)

  await setOperationLogs(currentLogs)
}

export async function clearOperationLogs(): Promise<void> {
  await persistentStorageArea.set({
    [BOOKMARK_OPERATION_LOGS_KEY]: []
  })
}

export function formatManagedFoldersSnapshot(snapshot: ManagedFoldersSnapshot): string {
  return snapshot.folderTitles.length > 0 ? snapshot.folderTitles.join(" / ") : "未选择"
}

export function formatBookmarkUrlSnapshot(snapshot: BookmarkUrlSnapshot): string {
  return `${snapshot.bookmarkTitle} · ${snapshot.bookmarkUrl ?? "空 URL"}`
}

export function formatOperationSnapshot(snapshot: OperationSnapshot): string {
  if (snapshot.snapshotType === "managed-folders") {
    return formatManagedFoldersSnapshot(snapshot)
  }

  return formatBookmarkUrlSnapshot(snapshot)
}
