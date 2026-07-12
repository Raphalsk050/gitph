import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { FilePen, GitBranch, Menu, RefreshCw, Search, Wifi } from 'lucide-react'
import type { GraphEdge, GraphRow, RepositorySnapshot } from '@shared/contracts'

interface CommitGraphProps {
  snapshot: RepositorySnapshot
  selectedOid: string | null
  loading: boolean
  /** Number of uncommitted files; the WIP row only appears when non-zero. */
  workingChanges: number
  workingSelected: boolean
  onSelectWorking(): void
  onSelect(oid: string): void
  onContextMenu(event: React.MouseEvent, row: GraphRow): void
  onRefresh(): void
  onFetch(): void
  onToggleSidebar(): void
}

const LANE_COLORS = ['#7e8dff', '#63a8ff', '#5bd6a4', '#e6b567', '#e58a9b', '#5bc8d4', '#b99bff', '#8fa0b3']
const LANE_ROW_HEIGHT = 48
const LANE_NODE_Y = LANE_ROW_HEIGHT / 2
const LANE_SPACING = 24
// Empty column left of lane 0 so the first lane has breathing room from the row
// edge, the way GitKraken insets its graph.
const LANE_GUTTER = 14

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
  onContextMenu,
  onRefresh,
  onFetch,
  onToggleSidebar
}: CommitGraphProps): React.JSX.Element {
  const [query, setQuery] = useState('')
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

  return (
    <main className="commit-workspace">
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
        <span>Graph &amp; message</span>
        <span>Author</span>
        <span>Committed</span>
      </div>
      <div className="commit-list" role="listbox" aria-label="Commit history">
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
        <div className="commit-list-content">
          {/* A filtered list renumbers rows, so lane connections would join
              commits that are not adjacent in history; show nodes only. */}
          {!normalizedQuery && <LaneConnections rows={rows} laneCount={laneCount} />}
          {rows.map((row) => (
            <CommitRow
              row={row}
              laneCount={laneCount}
              selected={selectedOid === row.commit.oid}
              isHead={row.commit.oid === headOid}
              detached={detached}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
              key={row.commit.oid}
            />
          ))}
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
  onContextMenu(event: React.MouseEvent, row: GraphRow): void
}

const CommitRow = memo(function CommitRow({
  row,
  laneCount,
  selected,
  isHead,
  detached,
  onSelect,
  onContextMenu
}: CommitRowProps): React.JSX.Element {
  const element = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) element.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  // The checked-out branch chip leads the row; a detached checkout has no
  // branch ref, so it gets a synthetic HEAD chip instead.
  const refs = [...row.refs].sort((a, b) => Number(b.isHead) - Number(a.isHead))
  return (
    <button
      ref={element}
      type="button"
      role="option"
      aria-selected={selected}
      className={`commit-row${selected ? ' selected' : ''}`}
      style={{ '--lane-color': laneColor(row.lane) } as React.CSSProperties}
      onClick={() => onSelect(row.commit.oid)}
      onContextMenu={(event) => onContextMenu(event, row)}
    >
      <div className="commit-primary">
        <LaneGraph
          row={row}
          laneCount={laneCount}
          selected={selected}
          isHead={isHead}
        />
        <div className="commit-copy">
          <div className="commit-subject-line">
            <span className="commit-subject">{row.commit.subject || '(no subject)'}</span>
            {detached && isHead && <span className="commit-ref detached">HEAD</span>}
            {refs.slice(0, 2).map((ref) => (
              <span className={`commit-ref ${ref.kind}${ref.isHead ? ' head' : ''}`} key={ref.fullName}>
                {ref.shortName}
              </span>
            ))}
            {refs.length > 2 && <span className="commit-ref more">+{refs.length - 2}</span>}
          </div>
          <span className="commit-oid">{row.commit.shortOid}</span>
        </div>
      </div>
      <span className="commit-author" title={row.commit.authorEmail}>
        <span className="commit-avatar" data-tone={authorTone(row.commit.author)}>{authorInitials(row.commit.author)}</span>
        {row.commit.author}
      </span>
      <span className="commit-time" title={formatFullDate(row.commit.commitTime)}>{relativeTime(row.commit.commitTime)}</span>
    </button>
  )
})

function LaneConnections({ rows, laneCount }: { rows: readonly GraphRow[]; laneCount: number }): React.JSX.Element | null {
  const connections = useMemo(() => buildLaneConnections(rows), [rows])
  if (rows.length === 0) return null

  const width = LANE_GUTTER + laneCount * LANE_SPACING
  const height = rows.length * LANE_ROW_HEIGHT
  return (
    <svg
      className="lane-connections"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
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

/**
 * Builds one continuous SVG path per commit-parent relationship.
 *
 * Responsibility: keep connection geometry and gradients independent from row
 * borders so long lanes cannot develop seams or orphaned visual fragments.
 */
function buildLaneConnections(rows: readonly GraphRow[]): LaneConnectionGeometry[] {
  const visualIndexByOid = new Map(rows.map((row, index) => [row.commit.oid, index]))
  const bottomY = rows.length * LANE_ROW_HEIGHT
  const connections: LaneConnectionGeometry[] = []

  rows.forEach((row, sourceIndex) => {
    row.edges.forEach((edge, edgeIndex) => {
      const targetIndex = visualIndexByOid.get(edge.toOid)
      if (targetIndex !== undefined && targetIndex <= sourceIndex) return
      connections.push(buildLaneConnection(edge, sourceIndex, targetIndex ?? null, edgeIndex, bottomY))
    })
  })
  return connections
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
 * - Parent beyond the loaded window (`targetIndex === null`): the line follows
 *   its column to the bottom of the graph and fades out, signalling that
 *   history continues past the commit limit.
 */
function buildLaneConnection(
  edge: GraphEdge,
  sourceIndex: number,
  targetIndex: number | null,
  edgeIndex: number,
  bottomY: number
): LaneConnectionGeometry {
  const sourceX = LANE_GUTTER + edge.fromLane * LANE_SPACING + LANE_SPACING / 2
  const targetX = LANE_GUTTER + edge.toLane * LANE_SPACING + LANE_SPACING / 2
  const sourceY = sourceIndex * LANE_ROW_HEIGHT + LANE_NODE_Y
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
    targetY = targetIndex * LANE_ROW_HEIGHT + LANE_NODE_Y
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
