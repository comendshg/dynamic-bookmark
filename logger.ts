const persistentStorageArea = chrome.storage.local

export const MANAGED_FOLDER_TITLES_KEY = "managedFolderTitles"
export const BOOKMARK_OPERATION_LOGS_KEY = "bookmarkOperationLogs"
export const MAX_OPERATION_LOGS = 100

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
