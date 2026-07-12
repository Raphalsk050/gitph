import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Cloud, FilePen, GitBranch, Menu, Monitor, RefreshCw, Search, Tag, Wifi } from 'lucide-react'
import type { GitRef, GraphEdge, GraphRow, RepositorySnapshot } from '@shared/contracts'

interface CommitGraphProps {
  snapshot: RepositorySnapshot
  selectedOid: string | null
  loading: boolean
  /** Number of uncommitted files; the WIP row only appears when non-zero. */
  workingChanges: number
  workingSelected: boolean
  onSelectWorking(): void
  onSelect(oid: string): void
  onSelectRef(ref: GitRef): void
  onCheckoutRef(ref: GitRef): void
  onContextMenu(event: React.MouseEvent, row: GraphRow): void
  onRefContextMenu(event: React.MouseEvent, ref: GitRef): void
  onRefresh(): void
  onFetch(): void
  onToggleSidebar(): void
}

// The same eight lane colours, ordered so neighbouring lanes land far apart on
// the colour wheel instead of drifting through similar hues. Five of the eight
// sit in the blue→purple range, so the three near-identical cool tones (blue,
// violet, slate) are pushed to lanes 0, 4 and 7 — never adjacent — while the
// distinct warm/green/cyan tones separate them. The first four lanes (the common
// case) get the widest hue jumps: blue → amber → green → pink.
const LANE_COLORS = [
  '#63a8ff', // blue    ~213°
  '#e6b567', // amber   ~37°
  '#5bd6a4', // green   ~156°
  '#e58a9b', // pink    ~349°
  '#7e8dff', // violet  ~233°
  '#5bc8d4', // cyan    ~186°
  '#b99bff', // purple  ~258°
  '#8fa0b3'  // slate   ~212°
]
const LANE_ROW_HEIGHT = 48
const LANE_NODE_Y = LANE_ROW_HEIGHT / 2
const LANE_SPACING = 24
const COMMIT_COLUMN_GAP = 8
const BRANCH_CONNECTOR_STROKE_WIDTH = 1.25
// Empty column left of lane 0 so the first lane has breathing room from the row
// edge, the way GitKraken insets its graph.
const LANE_GUTTER = 14
// Rows rendered above and below the viewport so fast scrolling never reveals a
// gap before the window recomputes.
const OVERSCAN_ROWS = 12
// Rows the window covers before the first measurement (a generous first paint).
const INITIAL_VISIBLE_ROWS = 60

interface RowWindow {
  /** First row index rendered (inclusive). */
  start: number
  /** One past the last row index rendered (exclusive). */
  end: number
}

/**
 * Tracks which slice of an evenly-sized list is on screen so the graph renders
 * only the visible rows plus a small overscan — the "lazy list" behaviour that
 * keeps a full-history graph responsive regardless of commit count.
 *
 * Measurement uses bounding rectangles rather than `offsetTop` so it stays
 * correct no matter which ancestor is the offset parent, and scroll handling is
 * coalesced into a single animation frame.
 */
function useRowWindow(
  scrollRef: React.RefObject<HTMLElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
  rowCount: number
): RowWindow {
  const [window, setWindow] = useState<RowWindow>({ start: 0, end: Math.min(rowCount, INITIAL_VISIBLE_ROWS) })

  const measure = useCallback(() => {
    const scroller = scrollRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    // How far the content has scrolled above the viewport's top edge.
    const viewTop = scroller.getBoundingClientRect().top - content.getBoundingClientRect().top
    const firstVisible = Math.floor(viewTop / LANE_ROW_HEIGHT)
    const visibleCount = Math.ceil(scroller.clientHeight / LANE_ROW_HEIGHT)
    const start = Math.max(0, firstVisible - OVERSCAN_ROWS)
    const end = Math.min(rowCount, firstVisible + visibleCount + OVERSCAN_ROWS)
    setWindow((current) => (current.start === start && current.end === end ? current : { start, end }))
  }, [scrollRef, contentRef, rowCount])

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    measure()
    let frame = 0
    const onScroll = (): void => {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(onScroll)
    observer.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [measure])

  return window
}

interface LaneConnectionGeometry {
  id: string
  gradientId: string | null
  path: string
  sourceY: number
  targetY: number
  strokeColor: string
  strokeWidth: number
  stops: LaneGradientStop[]
}

interface LaneGradientStop {
  offset: number
  opacity: number
  color: string
}

export function CommitGraph({
  snapshot,
  selectedOid,
  loading,
  workingChanges,
  workingSelected,
  onSelectWorking,
  onSelect,
  onSelectRef,
  onCheckoutRef,
  onContextMenu,
  onRefContextMenu,
  onRefresh,
  onFetch,
  onToggleSidebar
}: CommitGraphProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [activeRefName, setActiveRefName] = useState<string | null>(null)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const rows = useMemo(() => {
    if (!normalizedQuery) return snapshot.graph.rows
    return snapshot.graph.rows.filter(({ commit, refs }) =>
      [commit.oid, commit.subject, commit.author, ...refs.map((ref) => ref.shortName)]
        .join('\n')
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    )
  }, [normalizedQuery, snapshot.graph.rows])
  const laneCount = Math.max(1, snapshot.graph.maxLanes)
  const headOid = snapshot.identity.headOid
  const detached = headOid !== null && snapshot.identity.headRef === null
  const activeRef = useMemo(
    () => snapshot.refs.find((ref) => ref.fullName === activeRefName) ?? null,
    [activeRefName, snapshot.refs]
  )
  const highlightedOids = useMemo(
    () => activeRef ? collectBranchSegmentOids(snapshot.graph.rows, activeRef.displayOid) : null,
    [activeRef, snapshot.graph.rows]
  )
  const laneWidth = LANE_GUTTER + laneCount * LANE_SPACING

  const listRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const rowWindow = useRowWindow(listRef, contentRef, rows.length)
  const totalHeight = rows.length * LANE_ROW_HEIGHT
  const visibleRows = rows.slice(rowWindow.start, rowWindow.end)

  // Keep the selected commit on screen even when it is not currently rendered:
  // with virtualization the row may be unmounted, so the scroll is driven from
  // the container rather than from the row element itself.
  useLayoutEffect(() => {
    if (selectedOid === null) return
    const index = rows.findIndex((row) => row.commit.oid === selectedOid)
    if (index < 0) return
    const scroller = listRef.current
    const content = contentRef.current
    if (!scroller || !content) return
    const contentTop = content.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    const rowTop = contentTop + index * LANE_ROW_HEIGHT
    const rowBottom = rowTop + LANE_ROW_HEIGHT
    if (rowTop < scroller.scrollTop) scroller.scrollTop = rowTop
    else if (rowBottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = rowBottom - scroller.clientHeight
    }
  }, [selectedOid, rows])

  return (
    <main
      className={`commit-workspace${highlightedOids ? ' ancestry-highlight' : ''}`}
      style={{ '--lane-width': `${laneWidth}px` } as React.CSSProperties}
    >
      <div className="commit-toolbar">
        <button type="button" className="icon-button sidebar-toggle" aria-label="Toggle branches" onClick={onToggleSidebar}>
          <Menu size={18} />
        </button>
        <div className="toolbar-title">
          <GitBranch size={17} />
          <div>
            <strong>{snapshot.status.branchName ?? (detached ? 'Detached HEAD' : 'All branches')}</strong>
            <span>{snapshot.graph.rows.length} commits</span>
          </div>
        </div>
        <label className="commit-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search commits"
            aria-label="Search commits"
          />
          {query && <kbd>{rows.length}</kbd>}
        </label>
        <button type="button" className="toolbar-button" onClick={onFetch} disabled={loading}>
          <Wifi size={15} />
          <span>Fetch</span>
        </button>
        <button type="button" className="icon-button" aria-label="Refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} size={17} />
        </button>
      </div>

      <div className="commit-columns" aria-hidden="true">
        <span>Branch / tag</span>
        <span>Graph</span>
        <span>Commit message</span>
        <span>Author</span>
        <span>Committed</span>
      </div>
      <div className="commit-list" role="listbox" aria-label="Commit history" ref={listRef}>
        {/* The WIP row sits above the lane coordinate space, so it never shifts
            the connection overlay that is measured from commit-list-content. */}
        {workingChanges > 0 && (
          <button
            type="button"
            className={`wip-row${workingSelected ? ' selected' : ''}`}
            onClick={onSelectWorking}
          >
            <span className="wip-node"><FilePen size={13} /></span>
            <span className="wip-label">Uncommitted changes</span>
            <span className="wip-count">{workingChanges}</span>
          </button>
        )}
        {/* Height spans the whole history so the scrollbar reflects every commit;
            only the windowed slice below is actually mounted. */}
        <div className="commit-list-content" ref={contentRef} style={{ height: totalHeight }}>
          {/* A filtered list renumbers rows, so lane connections would join
              commits that are not adjacent in history; show nodes only. */}
          {!normalizedQuery && (
            <LaneConnections rows={rows} laneCount={laneCount} window={rowWindow} />
          )}
          <div
            className="commit-rows-window"
            style={{ transform: `translateY(${rowWindow.start * LANE_ROW_HEIGHT}px)` }}
          >
            {visibleRows.map((row) => (
              <CommitRow
                row={row}
                laneCount={laneCount}
                selected={selectedOid === row.commit.oid}
                isHead={row.commit.oid === headOid}
                detached={detached}
                onSelect={onSelect}
                onSelectRef={onSelectRef}
                onCheckoutRef={onCheckoutRef}
                onContextMenu={onContextMenu}
                onRefContextMenu={onRefContextMenu}
                activeRefName={activeRefName}
                highlightedOids={highlightedOids}
                onActiveRefChange={setActiveRefName}
                key={row.commit.oid}
              />
            ))}
          </div>
          {rows.length === 0 && (
            <div className="no-commits">
              <Search size={24} />
              <strong>No commits found</strong>
              <span>Try a different search term.</span>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

interface CommitRowProps {
  row: GraphRow
  laneCount: number
  selected: boolean
  isHead: boolean
  detached: boolean
  onSelect(oid: string): void
  onSelectRef(ref: GitRef): void
  onCheckoutRef(ref: GitRef): void
  onContextMenu(event: React.MouseEvent, row: GraphRow): void
  onRefContextMenu(event: React.MouseEvent, ref: GitRef): void
  activeRefName: string | null
  highlightedOids: ReadonlySet<string> | null
  onActiveRefChange(refName: string | null): void
}

const CommitRow = memo(function CommitRow({
  row,
  laneCount,
  selected,
  isHead,
  detached,
  onSelect,
  onSelectRef,
  onCheckoutRef,
  onContextMenu,
  onRefContextMenu,
  activeRefName,
  highlightedOids,
  onActiveRefChange
}: CommitRowProps): React.JSX.Element {
  const decorations = buildRefDecorations(row.refs)
  const isMuted = highlightedOids !== null && !highlightedOids.has(row.commit.oid)
  const isHighlighted = highlightedOids?.has(row.commit.oid) ?? false
  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={selected}
      className={`commit-row${selected ? ' selected' : ''}${isMuted ? ' ancestry-muted' : ''}${isHighlighted ? ' ancestry-active' : ''}`}
      style={{ '--lane-color': isHead ? 'var(--accent)' : laneColor(row.lane) } as React.CSSProperties}
      onClick={() => onSelect(row.commit.oid)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(row.commit.oid)
      }}
      onContextMenu={(event) => onContextMenu(event, row)}
    >
      <div className="branch-tip-cell">
        {detached && isHead ? (
          <span className="branch-ref-label detached">HEAD</span>
        ) : decorations.length > 0 ? (
          <RefDecorationCluster
            decorations={decorations}
            activeRefName={activeRefName}
            onSelectRef={onSelectRef}
            onCheckoutRef={onCheckoutRef}
            onContextMenu={onRefContextMenu}
            onActiveRefChange={onActiveRefChange}
          />
        ) : null}
        {(decorations.length > 0 || (detached && isHead)) && (
          <span className="branch-tip-line" aria-hidden="true">
            <svg width="100%" height={LANE_ROW_HEIGHT} shapeRendering="geometricPrecision">
              <line
                x1="0"
                y1={LANE_NODE_Y}
                x2="100%"
                y2={LANE_NODE_Y}
                stroke="var(--lane-color)"
                strokeWidth={BRANCH_CONNECTOR_STROKE_WIDTH}
                strokeLinecap="butt"
              />
            </svg>
          </span>
        )}
      </div>
      <LaneGraph row={row} laneCount={laneCount} selected={selected} isHead={isHead} />
      <div className="commit-copy">
        <span className="commit-subject">{row.commit.subject || '(no subject)'}</span>
        <span className="commit-oid">{row.commit.shortOid}</span>
      </div>
      <span className="commit-author" title={row.commit.authorEmail}>
        <span className="commit-avatar" data-tone={authorTone(row.commit.author)}>{authorInitials(row.commit.author)}</span>
        {row.commit.author}
      </span>
      <span className="commit-time" title={formatFullDate(row.commit.commitTime)}>{relativeTime(row.commit.commitTime)}</span>
    </div>
  )
})

interface RefDecoration {
  id: string
  label: string
  primaryRef: GitRef
  refs: GitRef[]
  kind: GitRef['kind']
  isHead: boolean
  hasLocal: boolean
  hasRemote: boolean
}

interface RefDecorationClusterProps {
  decorations: readonly RefDecoration[]
  activeRefName: string | null
  onSelectRef(ref: GitRef): void
  onCheckoutRef(ref: GitRef): void
  onContextMenu(event: React.MouseEvent, ref: GitRef): void
  onActiveRefChange(refName: string | null): void
}

function RefDecorationCluster({
  decorations,
  activeRefName,
  onSelectRef,
  onCheckoutRef,
  onContextMenu,
  onActiveRefChange
}: RefDecorationClusterProps): React.JSX.Element {
  return (
    <div
      className="branch-decoration-cluster"
      onMouseLeave={() => onActiveRefChange(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onActiveRefChange(null)
      }}
    >
      <RefDecorationButton
        decoration={decorations[0]}
        activeRefName={activeRefName}
        onSelectRef={onSelectRef}
        onCheckoutRef={onCheckoutRef}
        onContextMenu={onContextMenu}
        onActiveRefChange={onActiveRefChange}
      />
      {decorations.length > 1 && <span className="branch-ref-count">+{decorations.length - 1}</span>}
      {decorations.length > 1 && (
        <div className="branch-ref-overflow">
          {decorations.slice(1).map((decoration) => (
            <RefDecorationButton
              decoration={decoration}
              activeRefName={activeRefName}
              onSelectRef={onSelectRef}
              onCheckoutRef={onCheckoutRef}
              onContextMenu={onContextMenu}
              onActiveRefChange={onActiveRefChange}
              key={decoration.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RefDecorationButton({
  decoration,
  activeRefName,
  onSelectRef,
  onCheckoutRef,
  onContextMenu,
  onActiveRefChange
}: {
  decoration: RefDecoration
  activeRefName: string | null
  onSelectRef(ref: GitRef): void
  onCheckoutRef(ref: GitRef): void
  onContextMenu(event: React.MouseEvent, ref: GitRef): void
  onActiveRefChange(refName: string | null): void
}): React.JSX.Element {
  const isActive = decoration.refs.some((ref) => ref.fullName === activeRefName)
  return (
    <button
      type="button"
      className={`branch-ref-label ${decoration.kind}${decoration.isHead ? ' head' : ''}${isActive ? ' ref-active' : ''}${activeRefName && !isActive ? ' ref-muted' : ''}`}
      title={decoration.refs.map((ref) => ref.shortName).join(', ')}
      onMouseEnter={() => onActiveRefChange(decoration.primaryRef.fullName)}
      onFocus={() => onActiveRefChange(decoration.primaryRef.fullName)}
      onClick={(event) => {
        event.stopPropagation()
        onSelectRef(decoration.primaryRef)
      }}
      onDoubleClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onCheckoutRef(decoration.primaryRef)
      }}
      onContextMenu={(event) => {
        event.stopPropagation()
        onContextMenu(event, decoration.primaryRef)
      }}
    >
      {decoration.isHead && <span className="branch-head-check">✓</span>}
      <span>{decoration.label}</span>
      {decoration.hasLocal && <Monitor size={11} aria-label="Local branch" />}
      {decoration.hasRemote && <Cloud size={11} aria-label="Remote branch" />}
      {decoration.kind === 'tag' && <Tag size={11} aria-label="Tag" />}
    </button>
  )
}

/** Combines a local branch and its tracking ref into one compact decoration. */
function buildRefDecorations(refs: readonly GitRef[]): RefDecoration[] {
  const visible = refs.filter((ref) => !(ref.kind === 'remote_branch' && ref.fullName.endsWith('/HEAD')))
  const remoteRefs = visible.filter((ref) => ref.kind === 'remote_branch')
  const claimedRemotes = new Set<string>()
  const decorations: RefDecoration[] = []

  for (const local of visible.filter((ref) => ref.kind === 'local_branch')) {
    const matchingRemotes = remoteRefs.filter((remote) => {
      if (claimedRemotes.has(remote.fullName)) return false
      return remote.shortName === local.upstream || remoteBranchName(remote) === local.shortName
    })
    for (const remote of matchingRemotes) claimedRemotes.add(remote.fullName)
    decorations.push(makeRefDecoration(local.shortName, local, [local, ...matchingRemotes]))
  }

  for (const ref of visible) {
    if (ref.kind === 'local_branch') continue
    if (ref.kind === 'remote_branch' && claimedRemotes.has(ref.fullName)) continue
    decorations.push(makeRefDecoration(ref.shortName, ref, [ref]))
  }

  return decorations.sort((left, right) => {
    const headOrder = Number(right.isHead) - Number(left.isHead)
    if (headOrder !== 0) return headOrder
    const kindOrder = refKindOrder(left.kind) - refKindOrder(right.kind)
    return kindOrder !== 0 ? kindOrder : left.label.localeCompare(right.label)
  })
}

function makeRefDecoration(label: string, primaryRef: GitRef, refs: GitRef[]): RefDecoration {
  return {
    id: refs.map((ref) => ref.fullName).join('|'),
    label,
    primaryRef,
    refs,
    kind: primaryRef.kind,
    isHead: refs.some((ref) => ref.isHead),
    hasLocal: refs.some((ref) => ref.kind === 'local_branch'),
    hasRemote: refs.some((ref) => ref.kind === 'remote_branch')
  }
}

function remoteBranchName(ref: GitRef): string {
  const separator = ref.shortName.indexOf('/')
  return separator >= 0 ? ref.shortName.slice(separator + 1) : ref.shortName
}

function refKindOrder(kind: GitRef['kind']): number {
  if (kind === 'local_branch') return 0
  if (kind === 'remote_branch') return 1
  if (kind === 'tag') return 2
  return 3
}

/** Returns the first-parent lane segment before the branch converges with its base. */
function collectBranchSegmentOids(rows: readonly GraphRow[], startOid: string): ReadonlySet<string> {
  const rowsByOid = new Map(rows.map((row) => [row.commit.oid, row]))
  const segment = new Set<string>()
  let row = rowsByOid.get(startOid)
  const branchLane = row?.lane
  while (row && row.lane === branchLane && !segment.has(row.commit.oid)) {
    segment.add(row.commit.oid)
    const firstParent = row.edges.find((edge) => edge.kind === 'parent')
    if (!firstParent || firstParent.toLane !== branchLane) break
    row = rowsByOid.get(firstParent.toOid)
  }
  return segment
}

function LaneConnections({ rows, laneCount, window }: {
  rows: readonly GraphRow[]
  laneCount: number
  window: RowWindow
}): React.JSX.Element | null {
  const specs = useMemo(() => buildConnectionSpecs(rows), [rows])
  if (rows.length === 0) return null

  const totalRows = rows.length
  const width = LANE_GUTTER + laneCount * LANE_SPACING
  const height = Math.max(LANE_ROW_HEIGHT, (window.end - window.start) * LANE_ROW_HEIGHT)
  // Only connections whose row span crosses the visible window are built and
  // drawn; the SVG is offset to the window's top and its paths use
  // window-relative coordinates, so it never grows with the full history.
  const connections = specs
    .filter((spec) => spec.sourceIndex < window.end && (spec.targetIndex ?? totalRows) >= window.start)
    .map((spec) => buildLaneConnection(spec, window.start, totalRows))

  return (
    <svg
      className="lane-connections"
      width={width}
      height={height}
      style={{ top: window.start * LANE_ROW_HEIGHT }}
      shapeRendering="geometricPrecision"
      aria-hidden="true"
    >
      <defs>
        {connections.map((connection) => connection.gradientId ? (
          <linearGradient
            id={connection.gradientId}
            x1="0"
            y1={connection.sourceY}
            x2="0"
            y2={connection.targetY}
            gradientUnits="userSpaceOnUse"
            key={connection.gradientId}
          >
            {connection.stops.map((stop, index) => (
              <stop
                offset={`${stop.offset * 100}%`}
                stopColor={stop.color}
                stopOpacity={stop.opacity}
                key={`${stop.offset}-${index}`}
              />
            ))}
          </linearGradient>
        ) : null)}
      </defs>
      {connections.map((connection) => (
        <path
          className="lane-connection-path"
          d={connection.path}
          fill="none"
          stroke={connection.gradientId ? `url(#${connection.gradientId})` : connection.strokeColor}
          strokeWidth={connection.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          key={connection.id}
        />
      ))}
    </svg>
  )
}

function LaneGraph({ row, laneCount, selected, isHead }: {
  row: GraphRow
  laneCount: number
  selected: boolean
  isHead: boolean
}): React.JSX.Element {
  const width = LANE_GUTTER + laneCount * LANE_SPACING
  const nodeX = LANE_GUTTER + row.lane * LANE_SPACING + LANE_SPACING / 2
  const nodeColor = isHead ? 'var(--accent)' : laneColor(row.lane)
  return (
    <svg
      className="lane-graph lane-node-graph"
      width={width}
      viewBox={`0 0 ${width} ${LANE_ROW_HEIGHT}`}
      shapeRendering="geometricPrecision"
      aria-hidden="true"
    >
      {(row.refs.length > 0 || isHead) && (
        <line
          className="branch-node-connector"
          x1={-COMMIT_COLUMN_GAP}
          y1={LANE_NODE_Y}
          x2={nodeX}
          y2={LANE_NODE_Y}
          stroke={nodeColor}
          strokeWidth={BRANCH_CONNECTOR_STROKE_WIDTH}
          strokeLinecap="butt"
        />
      )}
      {selected && <circle className="selected-node-ring" cx={nodeX} cy={LANE_NODE_Y} r="8.5" fill="none" stroke="var(--accent)" strokeOpacity="0.65" strokeWidth="3" />}
      {isHead ? (
        <>
          {/* HEAD reads as a ring: hollow center marks "you are here". */}
          <circle cx={nodeX} cy={LANE_NODE_Y} r="6.4" fill="var(--bg-base)" stroke={nodeColor} strokeWidth="2.2" />
          <circle cx={nodeX} cy={LANE_NODE_Y} r="2.4" fill={nodeColor} />
        </>
      ) : (
        <circle
          cx={nodeX}
          cy={LANE_NODE_Y}
          r={row.refs.length > 0 || row.commit.parents.length > 1 ? 5.2 : 4.4}
          fill={nodeColor}
          stroke="var(--bg-base)"
          strokeWidth="1.4"
        />
      )}
    </svg>
  )
}

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]
}

function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return '?'
  return `${parts[0][0]}${parts.length > 1 ? parts.at(-1)?.[0] ?? '' : ''}`.toUpperCase()
}

// Stable tone per author (0..4) so an author keeps the same avatar colour.
function authorTone(name: string): number {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return hash % 5
}

const FADE_OUT_ROWS = 3

interface LaneConnectionSpec {
  edge: GraphEdge
  sourceIndex: number
  targetIndex: number | null
  edgeIndex: number
}

/**
 * Resolves every commit-parent relationship to a row-index span, once per graph.
 *
 * Responsibility: capture the render-neutral shape of each connection (its lanes
 * and the rows it joins) so the view can cheaply select and draw only the spans
 * that cross the visible window, keeping geometry independent from row borders.
 */
function buildConnectionSpecs(rows: readonly GraphRow[]): LaneConnectionSpec[] {
  const visualIndexByOid = new Map(rows.map((row, index) => [row.commit.oid, index]))
  const specs: LaneConnectionSpec[] = []

  rows.forEach((row, sourceIndex) => {
    row.edges.forEach((edge, edgeIndex) => {
      const targetIndex = visualIndexByOid.get(edge.toOid)
      if (targetIndex !== undefined && targetIndex <= sourceIndex) return
      specs.push({ edge, sourceIndex, targetIndex: targetIndex ?? null, edgeIndex })
    })
  })
  return specs
}

/**
 * Geometry rules per edge kind. Every bend happens AT the row of the commit it
 * belongs to, so a turning line always has its node right beside the turn:
 * - `merge`: the line leaves the merge commit horizontally at its row, rounds a
 *   corner and runs down the merged branch's column (drawn in that branch's
 *   color).
 * - `parent` changing lane: the ending branch runs down its own column (which
 *   the lane builder reserves as a tail) and enters the parent horizontally at
 *   the parent's row, keeping the branch's color.
 * - Parent that is not part of the graph (`targetIndex === null`): the line
 *   follows its column to the bottom of the graph and fades out, signalling
 *   that history continues past what is loaded.
 *
 * Coordinates are expressed relative to `rowOffset` (the first row of the
 * visible window) so the connection SVG stays small no matter how tall the
 * full history is.
 */
function buildLaneConnection(
  spec: LaneConnectionSpec,
  rowOffset: number,
  totalRows: number
): LaneConnectionGeometry {
  const { edge, sourceIndex, targetIndex, edgeIndex } = spec
  const sourceX = LANE_GUTTER + edge.fromLane * LANE_SPACING + LANE_SPACING / 2
  const targetX = LANE_GUTTER + edge.toLane * LANE_SPACING + LANE_SPACING / 2
  const sourceY = (sourceIndex - rowOffset) * LANE_ROW_HEIGHT + LANE_NODE_Y
  const bottomY = (totalRows - rowOffset) * LANE_ROW_HEIGHT
  const changesLane = edge.fromLane !== edge.toLane
  const sourceColor = laneColor(edge.fromLane)
  const targetColor = laneColor(edge.toLane)
  const stops: LaneGradientStop[] = []
  let path: string
  let targetY: number
  let strokeColor = targetColor

  if (targetIndex === null) {
    targetY = bottomY
    const fadeStartY = Math.max(sourceY, bottomY - FADE_OUT_ROWS * LANE_ROW_HEIGHT)
    if (changesLane && edge.kind === 'merge') {
      path = elbowFromSource(sourceX, sourceY, targetX, targetY)
      stops.push(
        { offset: 0, opacity: 1, color: targetColor },
        { offset: verticalOffset(fadeStartY, sourceY, targetY), opacity: 1, color: targetColor },
        { offset: 1, opacity: 0, color: targetColor }
      )
    } else {
      strokeColor = sourceColor
      path = `M ${sourceX} ${sourceY} L ${sourceX} ${targetY}`
      stops.push(
        { offset: 0, opacity: 1, color: sourceColor },
        { offset: verticalOffset(fadeStartY, sourceY, targetY), opacity: 1, color: sourceColor },
        { offset: 1, opacity: 0, color: sourceColor }
      )
    }
  } else {
    targetY = (targetIndex - rowOffset) * LANE_ROW_HEIGHT + LANE_NODE_Y
    if (!changesLane) {
      path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`
    } else if (edge.kind === 'merge') {
      path = elbowFromSource(sourceX, sourceY, targetX, targetY)
    } else {
      strokeColor = sourceColor
      path = elbowIntoTarget(sourceX, sourceY, targetX, targetY)
    }
  }

  return {
    id: `${edge.fromOid}:${edge.toOid}:${edgeIndex}`,
    gradientId: stops.length > 0
      ? `lane-connection-${sourceIndex}-${targetIndex ?? 'out'}-${edgeIndex}`
      : null,
    path,
    sourceY,
    targetY,
    strokeColor,
    strokeWidth: edge.kind === 'merge' ? 2.5 : 2.25,
    stops
  }
}

const ELBOW_RADIUS = 24

/**
 * Leaves the source commit horizontally at its own row, rounds one corner and
 * drops down the target column. The bend sits beside the source node.
 */
function elbowFromSource(sx: number, sy: number, tx: number, ty: number): string {
  const direction = tx > sx ? 1 : -1
  const radius = Math.min(ELBOW_RADIUS, Math.abs(tx - sx), ty - sy)
  return `M ${sx} ${sy} L ${tx - direction * radius} ${sy} Q ${tx} ${sy}, ${tx} ${sy + radius} L ${tx} ${ty}`
}

/**
 * Runs down the source column and enters the target commit horizontally at the
 * target's row. The bend sits beside the target node.
 */
function elbowIntoTarget(sx: number, sy: number, tx: number, ty: number): string {
  const direction = tx > sx ? 1 : -1
  const radius = Math.min(ELBOW_RADIUS, Math.abs(tx - sx), ty - sy)
  return `M ${sx} ${sy} L ${sx} ${ty - radius} Q ${sx} ${ty}, ${sx + direction * radius} ${ty} L ${tx} ${ty}`
}

function verticalOffset(y: number, sourceY: number, targetY: number): number {
  const totalHeight = Math.max(targetY - sourceY, Number.EPSILON)
  return Math.min(Math.max((y - sourceY) / totalHeight, 0), 1)
}

function relativeTime(timestamp: number): string {
  const difference = timestamp * 1000 - Date.now()
  const absolute = Math.abs(difference)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (absolute < 60_000) return formatter.format(Math.round(difference / 1000), 'second')
  if (absolute < 3_600_000) return formatter.format(Math.round(difference / 60_000), 'minute')
  if (absolute < 86_400_000) return formatter.format(Math.round(difference / 3_600_000), 'hour')
  if (absolute < 2_592_000_000) return formatter.format(Math.round(difference / 86_400_000), 'day')
  return new Date(timestamp * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatFullDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString()
}
