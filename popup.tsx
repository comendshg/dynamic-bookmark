import { useEffect, useMemo, useState } from "react"

const MANAGED_FOLDER_TITLES_KEY = "managedFolderTitles"

const persistentStorageArea = chrome.storage.local

type FolderOption = {
  title: string
  samplePath: string
  occurrenceCount: number
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

function collectFolderOptions(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  parentPath: string[] = [],
  groupedOptions = new Map<string, Set<string>>()
): Map<string, Set<string>> {
  for (const node of nodes) {
    if (node.url) {
      continue
    }

    const nextPath = [...parentPath, node.title]
    const pathLabel = nextPath.join(" / ")

    if (!groupedOptions.has(node.title)) {
      groupedOptions.set(node.title, new Set())
    }

    groupedOptions.get(node.title)?.add(pathLabel)

    if (node.children?.length) {
      collectFolderOptions(node.children, nextPath, groupedOptions)
    }
  }

  return groupedOptions
}

function IndexPopup() {
  const [folderOptions, setFolderOptions] = useState<FolderOption[]>([])
  const [selectedFolderTitles, setSelectedFolderTitles] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")

  const selectedTitleSet = useMemo(() => new Set(selectedFolderTitles), [selectedFolderTitles])

  useEffect(() => {
    let isActive = true

    async function loadPopupData() {
      try {
        const [bookmarkTree, storedResult] = await Promise.all([
          getBookmarkBarRootNode(),
          persistentStorageArea.get(MANAGED_FOLDER_TITLES_KEY)
        ])

        const bookmarkBarRoot = bookmarkTree

        const groupedOptions = bookmarkBarRoot?.children ? collectFolderOptions(bookmarkBarRoot.children) : new Map()
        const options: FolderOption[] = [...groupedOptions.entries()]
          .map(([title, paths]) => ({
            title,
            samplePath: [...paths][0] ?? title,
            occurrenceCount: paths.size
          }))
          .sort((left, right) => left.title.localeCompare(right.title))

        const storedTitles = storedResult[MANAGED_FOLDER_TITLES_KEY]
        const nextSelectedTitles = Array.isArray(storedTitles)
          ? normalizeManagedFolderTitles(storedTitles.filter((title): title is string => typeof title === "string"))
          : []

        if (!isActive) {
          return
        }

        setFolderOptions(options)
        setSelectedFolderTitles(nextSelectedTitles)
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
        folderTitles: selectedFolderTitles
      })

      if (!response?.ok) {
        throw new Error("background rejected the update")
      }

      const nextFolderTitles = Array.isArray(response.folderTitles)
        ? normalizeManagedFolderTitles(response.folderTitles.filter((title: unknown): title is string => typeof title === "string"))
        : normalizeManagedFolderTitles(selectedFolderTitles)

      setSelectedFolderTitles(nextFolderTitles)
      setStatusMessage("已保存，关闭标签页时会按所选收藏夹接管。")
    } catch (error) {
      setStatusMessage("保存失败，请稍后重试。")
      console.error("[Dynamic Bookmark] Failed to save managed folders:", error)
    } finally {
      setIsSaving(false)
    }
  }

  function toggleFolderTitle(title: string) {
    setSelectedFolderTitles((currentTitles) =>
      currentTitles.includes(title)
        ? currentTitles.filter((currentTitle) => currentTitle !== title)
        : [...currentTitles, title]
    )
  }

  function selectAllFolders() {
    setSelectedFolderTitles(folderOptions.map((option) => option.title))
  }

  function clearSelection() {
    setSelectedFolderTitles([])
  }

  return (
    <div
      style={{
        boxSizing: "border-box",
        minHeight: 420,
        padding: 16,
        width: 380,
        background:
          "radial-gradient(circle at top left, rgba(255, 214, 102, 0.22), transparent 35%), linear-gradient(180deg, #1f232b 0%, #15181e 100%)",
        color: "#eef2f7",
        fontFamily:
          'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
      }}>
      <div
        style={{
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)"
        }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: 0.2 }}>Dynamic Bookmark</div>
        <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5, color: "rgba(238, 242, 247, 0.72)" }}>
          选择要由插件接管的收藏夹。保存后，关闭标签页时会按收藏夹名自动更新对应书签。
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 12
        }}>
        <button
          disabled={isLoading || isSaving}
          onClick={selectAllFolders}
          style={{
            flex: 1,
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 10,
            padding: "8px 10px",
            background: "rgba(255, 255, 255, 0.05)",
            color: "#eef2f7",
            cursor: isLoading || isSaving ? "not-allowed" : "pointer"
          }}>
          全选
        </button>
        <button
          disabled={isLoading || isSaving}
          onClick={clearSelection}
          style={{
            flex: 1,
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 10,
            padding: "8px 10px",
            background: "rgba(255, 255, 255, 0.05)",
            color: "#eef2f7",
            cursor: isLoading || isSaving ? "not-allowed" : "pointer"
          }}>
          清空
        </button>
      </div>

      <div
        style={{
          maxHeight: 250,
          overflowY: "auto",
          paddingRight: 4
        }}>
        {isLoading ? (
          <div style={{ padding: "18px 0", color: "rgba(238, 242, 247, 0.7)" }}>正在加载收藏夹列表...</div>
        ) : folderOptions.length === 0 ? (
          <div
            style={{
              padding: 16,
              borderRadius: 12,
              background: "rgba(255, 255, 255, 0.05)",
              color: "rgba(238, 242, 247, 0.72)"
            }}>
            没有找到可用收藏夹。
          </div>
        ) : (
          folderOptions.map((option) => {
            const isSelected = selectedTitleSet.has(option.title)

            return (
              <label
                key={option.title}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  marginBottom: 10,
                  padding: 12,
                  borderRadius: 14,
                  border: isSelected ? "1px solid rgba(255, 214, 102, 0.55)" : "1px solid rgba(255, 255, 255, 0.08)",
                  background: isSelected ? "rgba(255, 214, 102, 0.12)" : "rgba(255, 255, 255, 0.04)",
                  cursor: "pointer"
                }}>
                <input
                  checked={isSelected}
                  onChange={() => toggleFolderTitle(option.title)}
                  style={{ marginTop: 4, accentColor: "#ffd666" }}
                  type="checkbox"
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.4 }}>{option.title}</div>
                  <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.45, color: "rgba(238, 242, 247, 0.66)" }}>
                    {option.samplePath}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 12, color: "rgba(238, 242, 247, 0.48)" }}>
                    {option.occurrenceCount} 个同名收藏夹位置
                  </div>
                </div>
              </label>
            )
          })
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginTop: 14
        }}>
        <div style={{ fontSize: 12, color: "rgba(238, 242, 247, 0.62)" }}>
          已选择 {selectedFolderTitles.length} 个收藏夹
        </div>
        <button
          disabled={isLoading || isSaving}
          onClick={saveManagedFolders}
          style={{
            minWidth: 104,
            border: "none",
            borderRadius: 999,
            padding: "10px 14px",
            background: isSaving ? "linear-gradient(135deg, #9aa3af, #6b7280)" : "linear-gradient(135deg, #ffd666, #ffb347)",
            color: "#111318",
            fontWeight: 700,
            cursor: isLoading || isSaving ? "not-allowed" : "pointer",
            boxShadow: "0 10px 24px rgba(255, 179, 71, 0.22)"
          }}>
          {isSaving ? "保存中..." : "保存设置"}
        </button>
      </div>

      <div style={{ minHeight: 20, marginTop: 10, fontSize: 12, color: "rgba(238, 242, 247, 0.7)" }}>
        {statusMessage}
      </div>
    </div>
  )
}

export default IndexPopup
