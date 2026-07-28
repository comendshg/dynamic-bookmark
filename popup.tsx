import { useEffect, useMemo, useState } from "react"

const MANAGED_FOLDER_TITLES_KEY = "managedFolderTitles"

const persistentStorageArea = chrome.storage.local

type FolderOption = {
  title: string
  samplePath: string
  occurrenceCount: number
}

type TreeNode = {
  id: string
  title: string
  path: string
  children?: TreeNode[]
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

async function getBookmarkBarRootNode(): Promise<chrome.bookmarks.BookmarkTreeNode | undefined> {
  const tree = await chrome.bookmarks.getTree()
  const rootNode = tree[0]

  return rootNode?.children?.find((node) => node.id === "1") ?? rootNode?.children?.[0]
}

function buildTree(nodes: chrome.bookmarks.BookmarkTreeNode[], parentPath: string[] = []): TreeNode[] {
  return nodes
    .filter((n) => !n.url)
    .map((node) => {
      const nextPath = [...parentPath, node.title]
      const treeNode: TreeNode = {
        id: node.id,
        title: node.title,
        path: nextPath.join(" / "),
        children: node.children ? buildTree(node.children, nextPath) : undefined
      }

      return treeNode
    })
}

function collectAllFolderPaths(nodes: TreeNode[], collector: string[] = []): string[] {
  for (const n of nodes) {
    collector.push(n.path)

    if (n.children?.length) {
      collectAllFolderPaths(n.children, collector)
    }
  }

  return collector
}

function IndexPopup() {
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([])
  const [selectedFolderPaths, setSelectedFolderPaths] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")

  const selectedPathSet = useMemo(() => new Set(selectedFolderPaths), [selectedFolderPaths])
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    let isActive = true

    async function loadPopupData() {
      try {
        const [bookmarkTree, storedResult] = await Promise.all([
          getBookmarkBarRootNode(),
          persistentStorageArea.get(MANAGED_FOLDER_TITLES_KEY)
        ])

        const bookmarkBarRoot = bookmarkTree

        const tree = bookmarkBarRoot?.children ? buildTree(bookmarkBarRoot.children) : []
        const storedTitles = storedResult[MANAGED_FOLDER_TITLES_KEY]

        // storedTitles may be legacy simple titles or new path strings. Map legacy titles to all matching paths.
        const nextSelectedPaths: string[] = []

        if (Array.isArray(storedTitles)) {
          for (const raw of storedTitles) {
            if (typeof raw !== "string") continue

            const normalized = raw.trim()

            if (!normalized) continue

            if (normalized.includes("/")) {
              // assume already a path like "A / B / C"
              nextSelectedPaths.push(normalized)
            } else {
              // legacy: find by title and add all matching folder paths
              const stack: TreeNode[] = [...tree]

              while (stack.length) {
                const node = stack.pop()!

                if (node.title === normalized) {
                  nextSelectedPaths.push(node.path)
                }

                if (node.children) stack.push(...node.children)
              }
            }
          }
        }

        if (!isActive) return

        setTreeNodes(tree)
        setSelectedFolderPaths(nextSelectedPaths)
        setStatusMessage("")
      } catch (error) {
        if (!isActive) {
          return
        }

        setStatusMessage("加载收藏夹失败，请刷新后重试。")
        console.error("[Dynamic Bookmark] Failed to load popup data:", error)
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadPopupData()

    return () => {
      isActive = false
    }
  }, [])

  async function saveManagedFolders() {
    setIsSaving(true)
    setStatusMessage("")

    try {
      const response = await chrome.runtime.sendMessage({
        type: "set-managed-folders",
        folderTitles: selectedFolderPaths
      })

      if (!response?.ok) {
        throw new Error("background rejected the update")
      }

      const nextFolderTitles = Array.isArray(response.folderTitles)
        ? response.folderTitles.filter((t: unknown): t is string => typeof t === "string").map((s) => s.trim())
        : selectedFolderPaths

      setSelectedFolderPaths(nextFolderTitles)
      setStatusMessage("已保存，关闭标签页时会按所选收藏夹接管。")
    } catch (error) {
      setStatusMessage("保存失败，请稍后重试。")
      console.error("[Dynamic Bookmark] Failed to save managed folders:", error)
    } finally {
      setIsSaving(false)
    }
  }

  async function openLogsPage() {
    try {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("tabs/log.html")
      })
    } catch (error) {
      setStatusMessage("打开日志页失败，请稍后重试。")
      console.error("[Dynamic Bookmark] Failed to open logs page:", error)
    }
  }

  function toggleFolderPath(path: string) {
    setSelectedFolderPaths((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path]))
  }

  function selectAllFolders() {
    setSelectedFolderPaths(collectAllFolderPaths(treeNodes))
  }

  function clearSelection() {
    setSelectedFolderPaths([])
  }

  // Folder tree node renderer
  function FolderTreeNode(props: {
    node: TreeNode
    depth: number
    isCollapsed: boolean
    toggleCollapse: (id: string) => void
    selectedPathSet: Set<string>
    onTogglePath: (path: string) => void
  }) {
    const { node, depth, isCollapsed, toggleCollapse, selectedPathSet, onTogglePath } = props

    const hasChildren = !!(node.children && node.children.length)
    const isSelected = selectedPathSet.has(node.path)

    return (
      <div style={{ paddingLeft: depth * 12 }}>
        <label
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "8px 12px",
            borderRadius: 8,
            border: isSelected ? "1px solid rgba(34, 123, 122, 0.4)" : "1px solid transparent",
            background: isSelected ? "rgba(28, 62, 63, 0.6)" : "transparent",
            cursor: "pointer",
            transition: "all 0.12s ease",
            marginRight: 4
          }}>
          {hasChildren ? (
            <button
              onClick={(e) => {
                e.preventDefault()
                toggleCollapse(node.id)
              }}
              style={{
                width: 22,
                height: 22,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                color: "#94A3B8",
                cursor: "pointer"
              }}>
              {isCollapsed ? "▶" : "▼"}
            </button>
          ) : (
            <div style={{ width: 22 }} />
          )}

          <input
            checked={isSelected}
            onChange={() => onTogglePath(node.path)}
            style={{ width: 16, height: 16, margin: 0, accentColor: "#227B7A", cursor: "pointer" }}
            type="checkbox"
          />

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, color: "#FFF" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
              </svg>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.title}</div>
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: "#94A3B8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{node.path}</div>
          </div>
        </label>

        {!isCollapsed && hasChildren && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {node.children!.map((child) => (
              <FolderTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                isCollapsed={collapsedIds.has(child.id)}
                toggleCollapse={toggleCollapse}
                selectedPathSet={selectedPathSet}
                onTogglePath={onTogglePath}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        boxSizing: "border-box",
        minHeight: 400,
        height: "100%",
        padding: 16,
        width: 360,
        background: "#181A1F",
        color: "#F8FAFC",
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
        display: "flex",
        flexDirection: "column",
        borderRadius: 12,
        overflow: "hidden"
      }}>
      <style>
        {`
          html, body {
            margin: 0;
            padding: 0;
            background: #181A1F;
            border-radius: 30px;
            overflow: hidden;
          }
          ::-webkit-scrollbar { width: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
        `}
      </style>

      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: 0.3 }}>Dynamic Bookmark</div>
        <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.4, color: "#94A3B8" }}>
          选择要由插件接管的收藏夹。保存后，关闭标签页时会按收藏夹名自动更新对应书签。
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 16
        }}>
        <button
          disabled={isLoading || isSaving}
          onClick={selectAllFolders}
          style={{
            flex: 1,
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: 8,
            padding: "8px",
            background: "rgba(255, 255, 255, 0.04)",
            color: "#F8FAFC",
            fontSize: 13,
            cursor: isLoading || isSaving ? "not-allowed" : "pointer",
            transition: "background 0.2s"
          }}>
          全选
        </button>
        <button
          disabled={isLoading || isSaving}
          onClick={clearSelection}
          style={{
            flex: 1,
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: 8,
            padding: "8px",
            background: "rgba(255, 255, 255, 0.04)",
            color: "#F8FAFC",
            fontSize: 13,
            cursor: isLoading || isSaving ? "not-allowed" : "pointer",
            transition: "background 0.2s"
          }}>
          清空
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(255, 255, 255, 0.05)",
          borderRadius: 8,
          padding: "8px 4px 8px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minHeight: 200,
          maxHeight: 250
        }}>
        {isLoading ? (
          <div style={{ padding: "16px", color: "#94A3B8", fontSize: 13 }}>正在加载收藏夹列表...</div>
        ) : treeNodes.length === 0 ? (
          <div style={{ padding: "16px", color: "#94A3B8", fontSize: 13 }}>没有找到可用收藏夹。</div>
        ) : (
          // recursive render
          treeNodes.map((node) => (
            <FolderTreeNode
              key={node.path}
              node={node}
              depth={0}
              isCollapsed={collapsedIds.has(node.id)}
              toggleCollapse={(id) =>
                setCollapsedIds((prev) => {
                  const next = new Set(prev)

                  if (next.has(id)) next.delete(id)
                  else next.add(id)

                  return next
                })
              }
              selectedPathSet={selectedPathSet}
              onTogglePath={toggleFolderPath}
            />
          ))
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 16
        }}>
        <div style={{ fontSize: 13, color: "#94A3B8" }}>
          已选择 {selectedFolderPaths.length} 个收藏夹
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            disabled={isLoading || isSaving}
            onClick={openLogsPage}
            style={{
              border: "1px solid rgba(255, 255, 255, 0.1)",
              borderRadius: 6,
              padding: "8px 14px",
              background: "rgba(255, 255, 255, 0.04)",
              color: "#F8FAFC",
              fontSize: 13,
              fontWeight: 500,
              cursor: isLoading || isSaving ? "not-allowed" : "pointer",
              transition: "background 0.2s"
            }}>
            日志查看
          </button>
          <button
            disabled={isLoading || isSaving}
            onClick={saveManagedFolders}
            style={{
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              background: isSaving ? "#475569" : "#1A6F6C",
              color: "#FFF",
              fontSize: 13,
              fontWeight: 500,
              cursor: isLoading || isSaving ? "not-allowed" : "pointer",
              transition: "background 0.2s"
            }}>
            {isSaving ? "保存中..." : "保存设置"}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div style={{ marginTop: 12, fontSize: 12, color: "#94A3B8" }}>
          {statusMessage}
        </div>
      )}
    </div>
  )
}

export default IndexPopup
