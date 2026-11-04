import { useEffect, useMemo, useState } from "react"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  SearchIcon,
  XIcon
} from "./icons"
import { SavedFlash } from "./common"

import {
  MANAGED_FOLDER_IDS_KEY,
  MANAGED_FOLDER_TITLES_KEY,
  resolveFolderPaths
} from "../logger"

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

function buildTree(
  nodes: chrome.bookmarks.BookmarkTreeNode[],
  parentPath: string[] = [],
  parentId?: string
): TreeNode[] {
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
        path: nextPath.join(" / "),
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

/* ------------------------------------------------------------
   文件夹行：必须定义在组件外部，避免每次渲染产生新组件类型导致 remount
   ------------------------------------------------------------ */

function FolderRow(props: {
  node: TreeNode
  showPath: boolean
  isSelected: boolean
  isCoveredByAncestor: boolean
  hasSelectedDescendant: boolean
  onSelect: (id: string) => void
  onNavigate?: (node: TreeNode) => void
}) {
  const { node, showPath, isSelected, isCoveredByAncestor, hasSelectedDescendant, onSelect, onNavigate } = props

  const canNavigate = !!onNavigate
  const checked = isSelected || isCoveredByAncestor

  return (
    <div
      className={`db-row${isSelected ? " is-selected" : ""}`}
      style={{
        marginBottom: 6,
        cursor: canNavigate ? "pointer" : "default"
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
        style={{ width: 16, height: 16, margin: 0, cursor: isCoveredByAncestor ? "default" : "pointer" }}
        type="checkbox"
      />

      <span style={{ color: isSelected ? "var(--accent)" : "var(--t3)" }}>
        <FolderIcon size={16} />
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              fontSize: 13.5,
              fontWeight: 500,
              color: isCoveredByAncestor ? "var(--t2)" : "var(--t1)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap"
            }}>
            {node.title}
          </div>
          <span className="db-chip" style={{ fontSize: 10.5, padding: "1px 8px" }}>{node.bookmarkCount} 个书签</span>
          {isCoveredByAncestor && (
            <span className="db-chip" style={{ fontSize: 10, padding: "1px 8px" }} title="已包含于选中的上级文件夹，会随父级一起接管">
              已含于上级
            </span>
          )}
          {isSelected && <span className="db-chip db-chip-accent" style={{ fontSize: 10, padding: "1px 8px" }}>已接管</span>}
        </div>
        {showPath && (
          <div
            className="mono"
            style={{
              marginTop: 4,
              fontSize: 11,
              color: "var(--t3)",
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
          className="db-icon-btn"
          onClick={(e) => {
            e.stopPropagation()
            onNavigate!(node)
          }}
          title={`进入「${node.title}」`}
          style={{ color: "var(--t3)" }}>
          <ChevronRightIcon size={15} />
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------
   托管文件夹区（原 settings 页核心，逻辑完整保留）
   ------------------------------------------------------------ */

export function FoldersSection(props: { onToast: (message: string, tone?: "info" | "error") => void }) {
  const { onToast } = props

  const [treeNodes, setTreeNodes] = useState<TreeNode[]>([])
  // 托管配置：文件夹 id 列表（稳定标识，改名/移动不受影响）
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [savedFlashKey, setSavedFlashKey] = useState(0)
  const [searchText, setSearchText] = useState("")
  // 面包屑下钻路径：存放各级文件夹标题，如 ["学习", "Rust 课程"]；空数组即书签栏顶层。
  const [breadcrumb, setBreadcrumb] = useState<string[]>([])

  const selectedIdSet = useMemo(() => new Set(selectedFolderIds), [selectedFolderIds])
  const isSearching = searchText.trim().length > 0

  const currentLevelNodes = useMemo(() => getNodesAtLevel(treeNodes, breadcrumb), [treeNodes, breadcrumb])

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
        onToast("加载收藏夹失败，请刷新后重试。", "error")
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 勾选即生效：每次选择变化立即发送到 background 保存。
  // 同时发送 id 与路径两套数据，兼容尚未重新加载的旧后台。
  async function persistManagedFolders(ids: string[]) {
    setIsSaving(true)

    const paths = await resolveFolderPaths(ids)

    try {
      const response = await chrome.runtime.sendMessage({
        type: "set-managed-folders",
        folderIds: ids,
        folderTitles: paths
      })

      if (!response?.ok) {
        throw new Error("background rejected the update")
      }

      const stored = await persistentStorageArea.get([MANAGED_FOLDER_IDS_KEY, MANAGED_FOLDER_TITLES_KEY])
      const storedIds = Array.isArray(stored[MANAGED_FOLDER_IDS_KEY])
        ? stored[MANAGED_FOLDER_IDS_KEY].filter((id): id is string => typeof id === "string")
        : []
      const storedTitles = Array.isArray(stored[MANAGED_FOLDER_TITLES_KEY])
        ? stored[MANAGED_FOLDER_TITLES_KEY].filter((title): title is string => typeof title === "string")
        : []

      const idsPersisted = storedIds.length === ids.length && ids.every((id) => storedIds.includes(id))
      const titlesPersisted = storedTitles.length === paths.length && paths.every((path) => storedTitles.includes(path))

      if (idsPersisted) {
        onToast(ids.length > 0 ? `已接管 ${ids.length} 个文件夹` : "已停用接管")
        setSavedFlashKey(Date.now())
        return
      }

      if (titlesPersisted) {
        onToast(`已接管 ${ids.length} 个文件夹（后台为旧版本，建议在扩展管理页重新加载）`)
        return
      }

      throw new Error("selection was not persisted")
    } catch (error) {
      onToast("保存未生效：请在扩展管理页点「重新加载」后再试。", "error")
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
    <section>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>托管文件夹</h1>
        <p style={{ margin: "6px 0 0", fontSize: 12.5, color: "var(--t2)", lineHeight: 1.6 }}>
          选择要接管的收藏夹。关掉标签页时，这些文件夹里的书签会被自动更新到最近浏览的位置。勾选即保存，勾选父级即接管整棵子树。
        </p>
      </div>

      <div className="db-card" style={{ padding: 16 }}>
        {/* 标题行 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <span className="db-chip db-chip-accent">
            {isSaving ? "保存中…" : `已接管 ${selectedFolderIds.length} 个`}
          </span>
          <span key={savedFlashKey} style={{ display: "inline-flex" }}>
            <SavedFlash visible={savedFlashKey > 0} />
          </span>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
            <button
              className="db-link"
              disabled={isSaving || isLoading || treeNodes.length === 0}
              onClick={selectAllAtCurrentLevel}
              title="勾选当前层级的全部文件夹"
              style={{ cursor: isSaving || isLoading ? "not-allowed" : "pointer" }}>
              全选本层
            </button>
            <button
              className="db-link db-link-muted"
              disabled={isSaving || selectedFolderIds.length === 0}
              onClick={() => applySelection([])}
              style={{ cursor: isSaving || selectedFolderIds.length === 0 ? "not-allowed" : "pointer" }}>
              清空
            </button>
          </div>
        </div>

        {/* 搜索框 + 返回按钮 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {breadcrumb.length > 0 && !isSearching && (
            <button
              className="db-btn"
              onClick={() => setBreadcrumb((current) => current.slice(0, -1))}
              title="返回上一层"
              style={{ width: 38, padding: 0 }}>
              <ChevronLeftIcon size={15} />
            </button>
          )}

          <div className="db-field" style={{ flex: 1, minWidth: 0 }}>
            <span style={{ color: "var(--t3)" }}>
              <SearchIcon size={14} />
            </span>
            <input
              placeholder="搜索文件夹（按名称或路径）…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {searchText && (
              <button
                className="db-icon-btn"
                onClick={() => setSearchText("")}
                style={{ width: 20, height: 20 }}>
                <XIcon size={12} />
              </button>
            )}
          </div>
        </div>

        {/* 面包屑 */}
        {!isSearching && breadcrumb.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 10, fontSize: 12.5 }}>
            <button className="db-link db-link-muted" onClick={() => setBreadcrumb([])}>
              书签栏
            </button>
            {breadcrumb.map((segment, index) => (
              <span key={index} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ color: "var(--t3)" }}>/</span>
                <button
                  className={`db-link${index === breadcrumb.length - 1 ? "" : " db-link-muted"}`}
                  onClick={() => setBreadcrumb(breadcrumb.slice(0, index + 1))}>
                  {segment}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 列表 */}
        <div
          style={{
            minHeight: 240,
            maxHeight: "46vh",
            overflowY: "auto",
            background: "var(--s2)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-m)",
            padding: 10
          }}>
          {isLoading ? (
            <div className="db-empty">正在加载收藏夹列表…</div>
          ) : isSearching ? (
            searchResults.length === 0 ? (
              <div className="db-empty">没有匹配「{searchText.trim()}」的文件夹。</div>
            ) : (
              searchResults.map((node) => <FolderRow key={node.id} showPath {...rowProps(node)} />)
            )
          ) : currentLevelNodes.length === 0 ? (
            <div className="db-empty">
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
              <span key={node.id} className="db-chip db-chip-accent" title={node.path} style={{ padding: "3px 6px 3px 11px", gap: 7 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{node.title}</span>
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
                    color: "var(--accent)",
                    cursor: "pointer",
                    padding: 0,
                    lineHeight: 1
                  }}>
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
