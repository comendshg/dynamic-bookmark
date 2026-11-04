import { useEffect, useMemo, useState } from "react"

const MANAGED_FOLDER_TITLES_KEY = "managedFolderTitles"
const MANAGED_FOLDER_IDS_KEY = "managedFolderIds"
const PATH_SEPARATOR = " / "

const persistentStorageArea = chrome.storage.local

type TreeNode = {
  id: string
  // 父文件夹 id（顶层为 undefined），用于勾选联动时沿祖先链判断
  parentId?: string
  title: string
  path: string
  // 该文件夹下（含各级子文件夹）的书签总数
  bookmarkCount: number
  children?: TreeNode[]
}

async function getBookmarkBarRootNode(): Promise<chrome.bookmarks.BookmarkTreeNode | undefined> {
  const tree = await chrome.bookmarks.getTree()
  const rootNode = tree[0]

  return rootNode?.children?.find((node) => node.id === "1") ?? rootNode?.children?.[0]
}

function buildTree(nodes: chrome.bookmarks.BookmarkTreeNode[], parentPath: string[] = [], parentId?: string): TreeNode[] {
  return nodes
    .filter((n) => !n.url)
    .map((node) => {
      const nextPath = [...parentPath, node.title]
      const children = node.children ? buildTree(node.children, nextPath, node.id) : undefined

      let bookmarkCount = 0

      if (node.children) {
        for (const child of node.children) {
          if (child.url) bookmarkCount += 1
        }

        if (children) {
          bookmarkCount += children.reduce((sum, child) => sum + child.bookmarkCount, 0)
        }
      }

      return {
        id: node.id,
        parentId,
        title: node.title,
        path: nextPath.join(PATH_SEPARATOR),
        bookmarkCount,
        children
      }
    })
}

function flattenFolders(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = []

  for (const node of nodes) {
    result.push(node)

    if (node.children?.length) {
      result.push(...flattenFolders(node.children))
    }
  }

  return result
}

// 按面包屑层级逐段下钻，返回当前层级的子文件夹列表。
function getNodesAtLevel(nodes: TreeNode[], segments: string[]): TreeNode[] {
  let current = nodes

  for (const segment of segments) {
    const found = current.find((node) => node.title === segment)

    if (!found) {
      return []
    }

    current = found.children ?? []
  }

  return current
}

// id -> 节点 的全局查找表，在树构建后填充一次。
const nodeByIdLookup = new Map<string, TreeNode>()

function rebuildLookup(tree: TreeNode[]): void {
  nodeByIdLookup.clear()

  for (const node of flattenFolders(tree)) {
    nodeByIdLookup.set(node.id, node)
  }
}

// 沿祖先链向上查找：是否存在已被选中的祖先文件夹。
function findSelectedAncestorId(node: TreeNode, selectedIdSet: Set<string>): string | undefined {
  let parentId = node.parentId

  while (parentId) {
    if (selectedIdSet.has(parentId)) {
      return parentId
    }

    parentId = nodeByIdLookup.get(parentId)?.parentId
  }

  return undefined
}

function hasSelectedDescendant(node: TreeNode, selectedIdSet: Set<string>): boolean {
  for (const child of node.children ?? []) {
    if (selectedIdSet.has(child.id) || hasSelectedDescendant(child, selectedIdSet)) {
      return true
    }
  }

  return false
}

function collectDescendantIds(node: TreeNode): string[] {
  const ids: string[] = []

  for (const child of node.children ?? []) {
    ids.push(child.id, ...collectDescendantIds(child))
  }

  return ids
}

// 单行文件夹条目：必须定义在页面组件外部，
// 否则每次渲染都会产生新的组件类型，导致子树反复 remount。
function FolderRow(props: {
  node: TreeNode
  showPath: boolean
  isSelected: boolean
  isCoveredByAncestor: boolean
  hasSelectedDescendant: boolean
  onSelect: (id: string) => void
  onNavigate?: (node: TreeNode) => void
}) {
  const {
    node,
    showPath,
    isSelected,
    isCoveredByAncestor,
    hasSelectedDescendant,
    onSelect,
    onNavigate
  } = props

  const canNavigate = !!onNavigate
  const checked = isSelected || isCoveredByAncestor

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 9,
        border: isSelected ? "1px solid rgba(94, 234, 212, 0.30)" : "1px solid rgba(255, 255, 255, 0.05)",
        background: isSelected ? "rgba(94, 234, 212, 0.08)" : "rgba(255, 255, 255, 0.02)",
        marginBottom: 6,
        cursor: canNavigate ? "pointer" : "default",
        transition: "border-color 0.12s ease, background 0.12s ease"
      }}
      onClick={() => {
        // 只有复选框负责勾选；点击行的其他位置进入下一级（无子级则无动作）。
        if (!canNavigate) {
          return
        }

        onNavigate!(node)
      }}>
      <input
        ref={(el) => {
          if (el) {
            el.indeterminate = !checked && hasSelectedDescendant
          }
        }}
        checked={checked}
        disabled={isCoveredByAncestor}
        onChange={() => onSelect(node.id)}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 16, height: 16, margin: 0, accentColor: "#14B8A6", cursor: isCoveredByAncestor ? "default" : "pointer", flexShrink: 0 }}
        type="checkbox"
      />

      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0, color: isSelected ? "#5EEAD4" : "#64748B" }}>
        <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      </svg>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: isCoveredByAncestor ? "#94A3B8" : "#F1F5F9",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>
            {node.title}
          </div>
          <span
            style={{
              flexShrink: 0,
              fontSize: 10.5,
              color: "#64748B",
              padding: "1px 8px",
              borderRadius: 999,
              background: "rgba(255, 255, 255, 0.04)",
              border: "1px solid rgba(255, 255, 255, 0.06)"
            }}>
            {node.bookmarkCount} 个书签
          </span>
          {isCoveredByAncestor && (
            <span
              title="已包含于选中的上级文件夹，会随父级一起接管"
              style={{
                flexShrink: 0,
                fontSize: 10,
                padding: "1px 8px",
                borderRadius: 999,
                color: "#64748B",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.08)"
              }}>
              已含于上级
            </span>
          )}
          {isSelected && (
            <span
              style={{
                flexShrink: 0,
                fontSize: 10,
                padding: "1px 8px",
                borderRadius: 999,
                color: "#5EEAD4",
                background: "rgba(94, 234, 212, 0.12)",
                border: "1px solid rgba(94, 234, 212, 0.30)"
              }}>
              已接管
            </span>
          )}
        </div>
        {showPath && (
          <div
            style={{
              marginTop: 4,
              fontSize: 11.5,
              color: "#64748B",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}>
            {node.path}
          </div>
        )}
      </div>

      {canNavigate && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNavigate!(node)
          }}
          title={`进入「${node.title}」`}
          style={{
            flexShrink: 0,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            borderRadius: 7,
            background: "transparent",
            border: "none",
            color: "#64748B",
            fontSize: 15,
            lineHeight: 1,
            cursor: "pointer"
          }}>
          ›
        </button>
      )}
    </div>
  )
}

function PageHeaderButton(props: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        border: "1px solid rgba(255, 255, 255, 0.10)",
        borderRadius: 8,
        padding: "9px 14px",
        background: "rgba(255, 255, 255, 0.04)",
        color: "#F8FAFC",
        fontSize: 13,
        cursor: props.disabled ? "not-allowed" : "pointer"
      }}>
      {props.label}
    </button>
  )
}

function IndexSettingsPage() {
  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([])
  // 托管配置：文件夹 id 列表（稳定标识，改名/移动不受影响）
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState("")
  const [statusTone, setStatusTone] = useState<"info" | "error">("info")
  const [searchText, setSearchText] = useState("")
  // 面包屑下钻路径：存放各级文件夹标题，如 ["学习", "Rust 课程"]；空数组即书签栏顶层。
  const [breadcrumb, setBreadcrumb] = useState<string[]>([])

  const selectedIdSet = useMemo(() => new Set(selectedFolderIds), [selectedFolderIds])
  const isSearching = searchText.trim().length > 0

  const currentLevelNodes = useMemo(
    () => getNodesAtLevel(treeNodes, breadcrumb),
    [treeNodes, breadcrumb]
  )

  const searchResults = useMemo(() => {
    if (!isSearching) {
      return []
    }

    const query = searchText.trim().toLowerCase()

    return flattenFolders(treeNodes).filter(
      (node) => node.title.toLowerCase().includes(query) || node.path.toLowerCase().includes(query)
    )
  }, [treeNodes, searchText, isSearching])

  const selectedNodes = useMemo(
    () =>
      selectedFolderIds
        .map((id) => nodeByIdLookup.get(id))
        .filter((node): node is TreeNode => !!node),
    // treeNodes 参与依赖：查找表在树加载后才有内容
    [selectedFolderIds, treeNodes]
  )

  useEffect(() => {
    let isActive = true

    async function loadData() {
      try {
        const [bookmarkTree, storedResult] = await Promise.all([
          getBookmarkBarRootNode(),
          persistentStorageArea.get([MANAGED_FOLDER_IDS_KEY, MANAGED_FOLDER_TITLES_KEY])
        ])

        const tree = bookmarkTree?.children ? buildTree(bookmarkTree.children) : []
        rebuildLookup(tree)

        let nextSelectedIds: string[] = []

        if (Array.isArray(storedResult[MANAGED_FOLDER_IDS_KEY])) {
          nextSelectedIds = storedResult[MANAGED_FOLDER_IDS_KEY].filter(
            (id): id is string => typeof id === "string"
          )
        } else {
          // legacy 配置：路径/标题字符串，映射到节点 id 仅用于展示，
          // 持久化迁移由 background 在启动时完成。
          const storedTitles = storedResult[MANAGED_FOLDER_TITLES_KEY]
          const pathToId = new Map<string, string>()

          for (const node of flattenFolders(tree)) {
            pathToId.set(node.path, node.id)
          }

          const pushByTitleOrPath = (raw: string) => {
            const normalized = raw.trim()

            if (!normalized) return

            if (normalized.includes("/")) {
              const id = pathToId.get(normalized)

              if (id && !nextSelectedIds.includes(id)) {
                nextSelectedIds.push(id)
              }
            } else {
              for (const node of flattenFolders(tree)) {
                if (node.title === normalized && !nextSelectedIds.includes(node.id)) {
                  nextSelectedIds.push(node.id)
                }
              }
            }
          }

          if (Array.isArray(storedTitles)) {
            for (const raw of storedTitles) {
              if (typeof raw === "string") {
                pushByTitleOrPath(raw)
              }
            }
          }
        }

        if (!isActive) return

        setTreeNodes(tree)
        setSelectedFolderIds(nextSelectedIds)
      } catch (error) {
        if (!isActive) {
          return
        }

        setStatusTone("error")
        setStatusMessage("加载收藏夹失败，请刷新后重试。")
        console.error("[Dynamic Bookmark] Failed to load settings:", error)
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadData()

    return () => {
      isActive = false
    }
  }, [])

  // 勾选即生效：每次选择变化立即发送到 background 保存。
  // 同时发送 id 与路径两套数据，兼容尚未重新加载的旧后台。
  async function persistManagedFolders(ids: string[]) {
    setIsSaving(true)

    const paths = ids
      .map((id) => nodeByIdLookup.get(id)?.path)
      .filter((path): path is string => !!path)

    try {
      const response = await chrome.runtime.sendMessage({
        type: "set-managed-folders",
        folderIds: ids,
        folderTitles: paths
      })

      if (!response?.ok) {
        throw new Error("background rejected the update")
      }

      const stored = await persistentStorageArea.get([
        MANAGED_FOLDER_IDS_KEY,
        MANAGED_FOLDER_TITLES_KEY
      ])
      const storedIds = Array.isArray(stored[MANAGED_FOLDER_IDS_KEY])
        ? stored[MANAGED_FOLDER_IDS_KEY].filter((id): id is string => typeof id === "string")
        : []
      const storedTitles = Array.isArray(stored[MANAGED_FOLDER_TITLES_KEY])
        ? stored[MANAGED_FOLDER_TITLES_KEY].filter((title): title is string => typeof title === "string")
        : []

      const idsPersisted =
        storedIds.length === ids.length && ids.every((id) => storedIds.includes(id))
      const titlesPersisted =
        storedTitles.length === paths.length && paths.every((path) => storedTitles.includes(path))

      if (idsPersisted) {
        setStatusTone("info")
        setStatusMessage(ids.length > 0 ? `已接管 ${ids.length} 个收藏夹` : "已停用接管")
        return
      }

      if (titlesPersisted) {
        setStatusTone("info")
        setStatusMessage(`已接管 ${ids.length} 个收藏夹（后台为旧版本，建议在扩展管理页重新加载）`)
        return
      }

      throw new Error("selection was not persisted")
    } catch (error) {
      setStatusTone("error")
      setStatusMessage("保存未生效：请在扩展管理页点「重新加载」后再试。")
      console.error("[Dynamic Bookmark] Failed to save managed folders:", error)
    } finally {
      setIsSaving(false)
    }
  }

  function applySelection(nextIds: string[]) {
    setSelectedFolderIds(nextIds)
    void persistManagedFolders(nextIds)
  }

  function toggleFolderId(id: string) {
    const node = nodeByIdLookup.get(id)

    if (selectedFolderIds.includes(id)) {
      applySelection(selectedFolderIds.filter((currentId) => currentId !== id))
      return
    }

    // 勾选父级时自动清理其下已选中的子孙：后台本来就递归接管整个子树。
    const descendantIds = node ? new Set(collectDescendantIds(node)) : new Set<string>()

    applySelection([...selectedFolderIds.filter((currentId) => !descendantIds.has(currentId)), id])
  }

  function selectAllAtCurrentLevel() {
    const seen = new Set(selectedFolderIds)
    const next = [...selectedFolderIds]

    for (const node of currentLevelNodes) {
      if (!seen.has(node.id)) {
        next.push(node.id)
      }
    }

    applySelection(next)
  }

  const rowProps = (node: TreeNode) => ({
    node,
    isSelected: selectedIdSet.has(node.id),
    isCoveredByAncestor: !selectedIdSet.has(node.id) && !!findSelectedAncestorId(node, selectedIdSet),
    hasSelectedDescendant: hasSelectedDescendant(node, selectedIdSet),
    onSelect: toggleFolderId
  })

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 24,
        boxSizing: "border-box",
        background: "#12141A",
        color: "#F8FAFC",
        fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'
      }}>
      <style>
        {`
          html, body { margin: 0; padding: 0; background: #12141A; }
          ::-webkit-scrollbar { width: 8px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.15); border-radius: 4px; }
          ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }
        `}
      </style>

      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          background: "rgba(255, 255, 255, 0.02)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: 16,
          padding: 20
        }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 0.2 }}>设置</div>
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.6, color: "#94A3B8" }}>
              选择要接管的收藏夹。这是一次性配置，选完之后插件会在后台自动维护这些书签的地址。
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>
            <PageHeaderButton label="日志" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("tabs/log.html") })} />
            <PageHeaderButton label="返回首页" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") })} />
          </div>
        </div>

        {/* 托管文件夹 */}
        <div
          style={{
            borderRadius: 14,
            border: "1px solid rgba(255, 255, 255, 0.07)",
            background: "rgba(255, 255, 255, 0.015)",
            padding: 16
          }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>托管文件夹</div>
            <span
              style={{
                fontSize: 11,
                padding: "2px 9px",
                borderRadius: 999,
                color: "#5EEAD4",
                background: "rgba(94, 234, 212, 0.10)",
                border: "1px solid rgba(94, 234, 212, 0.25)"
              }}>
              {isSaving ? "保存中..." : `已接管 ${selectedFolderIds.length} 个`}
            </span>

            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
              <button
                disabled={isSaving || isLoading || treeNodes.length === 0}
                onClick={selectAllAtCurrentLevel}
                title="勾选当前层级的全部文件夹"
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: "#94A3B8",
                  fontSize: 12.5,
                  cursor: isSaving || isLoading ? "not-allowed" : "pointer",
                  textDecoration: "underline",
                  textUnderlineOffset: 3
                }}>
                全选本层
              </button>
              <button
                disabled={isSaving || selectedFolderIds.length === 0}
                onClick={() => applySelection([])}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  color: selectedFolderIds.length === 0 ? "#475569" : "#94A3B8",
                  fontSize: 12.5,
                  cursor: isSaving || selectedFolderIds.length === 0 ? "not-allowed" : "pointer",
                  textDecoration: "underline",
                  textUnderlineOffset: 3
                }}>
                清空
              </button>
            </div>
          </div>

          <div style={{ fontSize: 12, lineHeight: 1.6, color: "#64748B", marginBottom: 12 }}>
            点复选框勾选，勾选即自动保存；点文件夹名称或 › 进入下一级。勾选父级即接管整棵子树。
          </div>

          {/* 搜索框 + 返回按钮 */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {breadcrumb.length > 0 && !isSearching && (
              <button
                onClick={() => setBreadcrumb((current) => current.slice(0, -1))}
                title="返回上一层"
                style={{
                  width: 38,
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 8,
                  color: "#94A3B8",
                  fontSize: 16,
                  cursor: "pointer"
                }}>
                ‹
              </button>
            )}

            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                background: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: 8
              }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#64748B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                placeholder="搜索收藏夹（按名称或路径）..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#F8FAFC",
                  fontSize: 13,
                  fontFamily: "inherit"
                }}
              />
              {searchText && (
                <button
                  onClick={() => setSearchText("")}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "none",
                    color: "#94A3B8",
                    fontSize: 11,
                    cursor: "pointer",
                    lineHeight: 1
                  }}>
                  ×
                </button>
              )}
            </div>
          </div>

          {/* 面包屑 */}
          {!isSearching && breadcrumb.length > 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 4,
                marginBottom: 10,
                fontSize: 12.5,
                color: "#64748B"
              }}>
              <button
                onClick={() => setBreadcrumb([])}
                style={{ background: "transparent", border: "none", padding: 0, color: "#94A3B8", fontSize: 12.5, cursor: "pointer" }}>
                书签栏
              </button>
              {breadcrumb.map((segment, index) => (
                <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span style={{ color: "#475569" }}>/</span>
                  <button
                    onClick={() => setBreadcrumb(breadcrumb.slice(0, index + 1))}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      color: index === breadcrumb.length - 1 ? "#5EEAD4" : "#94A3B8",
                      fontSize: 12.5,
                      cursor: "pointer"
                    }}>
                    {segment}
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* 列表 */}
          <div
            style={{
              minHeight: 300,
              maxHeight: "48vh",
              overflowY: "auto",
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid rgba(255, 255, 255, 0.05)",
              borderRadius: 10,
              padding: 10
            }}>
            {isLoading ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "#94A3B8", fontSize: 13 }}>正在加载收藏夹列表...</div>
            ) : isSearching ? (
              searchResults.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: "#64748B", fontSize: 13 }}>
                  没有匹配「{searchText.trim()}」的文件夹。
                </div>
              ) : (
                searchResults.map((node) => (
                  <FolderRow key={node.id} showPath {...rowProps(node)} />
                ))
              )
            ) : currentLevelNodes.length === 0 ? (
              <div style={{ padding: "32px 16px", textAlign: "center", color: "#94A3B8", fontSize: 13, lineHeight: 1.7 }}>
                {treeNodes.length === 0
                  ? "没有找到可用收藏夹。"
                  : "此文件夹下没有子文件夹了。勾选它即可接管整棵子树。"}
              </div>
            ) : (
              currentLevelNodes.map((node) => (
                <FolderRow
                  key={node.id}
                  showPath={false}
                  {...rowProps(node)}
                  onNavigate={
                    node.children?.length
                      ? (child) => {
                          setBreadcrumb((current) => [...current, child.title])
                          setSearchText("")
                        }
                      : undefined
                  }
                />
              ))
            )}
          </div>

          {/* 已选胶囊 */}
          {selectedNodes.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 7 }}>
              {selectedNodes.map((node) => (
                <span
                  key={node.id}
                  title={node.path}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 12.5,
                    padding: "4px 6px 4px 11px",
                    borderRadius: 999,
                    background: "rgba(94, 234, 212, 0.10)",
                    border: "1px solid rgba(94, 234, 212, 0.25)",
                    color: "#5EEAD4",
                    maxWidth: "100%"
                  }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.title}</span>
                  <button
                    onClick={() => toggleFolderId(node.id)}
                    title={`移除 ${node.path}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 17,
                      height: 17,
                      borderRadius: 999,
                      background: "transparent",
                      border: "none",
                      color: "#5EEAD4",
                      fontSize: 12,
                      cursor: "pointer",
                      lineHeight: 1,
                      flexShrink: 0
                    }}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {statusMessage && (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                lineHeight: 1.5,
                color: statusTone === "error" ? "#FCA5A5" : "#5EEAD4"
              }}>
              {statusMessage}
            </div>
          )}
        </div>

        {/* 预留：更多设置项 */}
        <div
          style={{
            marginTop: 14,
            borderRadius: 14,
            border: "1px dashed rgba(255, 255, 255, 0.10)",
            padding: "16px 18px",
            color: "#64748B",
            fontSize: 12.5,
            lineHeight: 1.7
          }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#94A3B8", marginBottom: 4 }}>更多设置</div>
          这一页后续会承载更多配置（例如「书签标题是否跟随页面标题」）。当前版本只有托管文件夹一项，配置保存在本机，不会上传。
        </div>
      </div>
    </div>
  )
}

export default IndexSettingsPage
