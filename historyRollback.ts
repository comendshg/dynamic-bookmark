import {
  appendOperationLog,
  createBookmarkUrlSnapshot,
  createManagedFoldersSnapshot,
  findFolderNodesByIdentifiers,
  getManagedFolderIds,
  resolveFolderPaths,
  serializeError,
  setManagedFolderIds,
  type OperationLogEntry,
  type OperationSnapshot
} from "./logger"

async function readCurrentSnapshot(snapshot: OperationSnapshot): Promise<OperationSnapshot> {
  if (snapshot.snapshotType === "managed-folders") {
    // 配置以 id 存储，快照仍然用路径展示。
    const currentIds = await getManagedFolderIds()
    return createManagedFoldersSnapshot(await resolveFolderPaths(currentIds))
  }

  const bookmarks = await chrome.bookmarks.get(snapshot.bookmarkId)
  const currentBookmark = bookmarks[0]

  if (!currentBookmark) {
    throw new Error(`找不到需要回退的书签：${snapshot.bookmarkId}`)
  }

  return createBookmarkUrlSnapshot(currentBookmark)
}

async function applySnapshot(snapshot: OperationSnapshot): Promise<void> {
  if (snapshot.snapshotType === "managed-folders") {
    // 历史快照里存的是路径字符串，回退时解析回文件夹 id 再写入配置。
    const folderNodes = await findFolderNodesByIdentifiers(snapshot.folderTitles)
    await setManagedFolderIds(folderNodes.map((node) => node.id))
    return
  }

  if (!snapshot.bookmarkUrl) {
    throw new Error(`书签 ${snapshot.bookmarkId} 没有可回退的 URL`)
  }

  await chrome.bookmarks.update(snapshot.bookmarkId, {
    url: snapshot.bookmarkUrl
  })
}

export async function rollbackOperationLogEntry(entry: OperationLogEntry): Promise<{ ok: boolean; message: string }> {
  const timestamp = Date.now()

  try {
    const beforeSnapshot = await readCurrentSnapshot(entry.before)

    await applySnapshot(entry.before)

    const afterSnapshot = await readCurrentSnapshot(entry.before)

    await appendOperationLog({
      timestamp,
      operationType: "rollback",
      before: beforeSnapshot,
      after: afterSnapshot,
      error: null,
      remark: "执行回退操作"
    })

    return {
      ok: true,
      message: "回退已完成。"
    }
  } catch (error) {
    const errorMessage = serializeError(error)

    try {
      await appendOperationLog({
        timestamp,
        operationType: "rollback",
        before: entry.before,
        after: entry.after,
        error: errorMessage,
        remark: "执行回退操作"
      })
    } catch (logError) {
      console.error("[Dynamic Bookmark] Failed to record rollback error log:", logError)
    }

    return {
      ok: false,
      message: `回退失败：${errorMessage}`
    }
  }
}
