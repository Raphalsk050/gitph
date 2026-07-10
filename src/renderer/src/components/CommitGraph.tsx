import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, Menu, RefreshCw, Search, Wifi } from 'lucide-react'
import type { GraphEdge, GraphRow, RepositorySnapshot } from '@shared/contracts'

interface CommitGraphProps {
  snapshot: RepositorySnapshot
  selectedOid: string | null
  loading: boolean
  onSelect(oid: string): void
  onContextMenu(event: React.MouseEvent, row: GraphRow): void
  onRefresh(): void
  onFetch(): void
  onToggleSidebar(): void
}

const LANE_COLORS = ['#16c7ff', '#287cff', '#8035e8', '#d52bbf', '#f01855', '#f26430', '#f0b83f', '#20c997']
const LANE_ROW_HEIGHT = 48
const LANE_NODE_Y = LANE_ROW_HEIGHT / 2
const LANE_SPACING = 18

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

  return (
    <main className="commit-workspace">
      <div className="commit-toolbar">
        <button type="button" className="icon-button sidebar-toggle" aria-label="Toggle branches" onClick={onToggleSidebar}>
          <Menu size={18} />
        </button>
        <div className="toolbar-title">
          <GitBranch size={17} />
          <div>
            <strong>{snapshot.status.branchName ?? 'All branches'}</strong>
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
        <div className="commit-list-content">
          {/* A filtered list renumbers rows, so lane connections would join
              commits that are not adjacent in history; show nodes only. */}
          {!normalizedQuery && <LaneConnections rows={rows} laneCount={laneCount} />}
          {rows.map((row) => (
            <CommitRow
              row={row}
              laneCount={laneCount}
              selected={selectedOid === row.commit.oid}
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
  onSelect(oid: string): void
  onContextMenu(event: React.MouseEvent, row: GraphRow): void
}

const CommitRow = memo(function CommitRow({
  row,
  laneCount,
  selected,
  onSelect,
  onContextMenu
}: CommitRowProps): React.JSX.Element {
  const element = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (selected) element.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={element}
      type="button"
      role="option"
      aria-selected={selected}
      className={`commit-row${selected ? ' selected' : ''}`}
      onClick={() => onSelect(row.commit.oid)}
      onContextMenu={(event) => onContextMenu(event, row)}
    >
      <div className="commit-primary">
        <LaneGraph
          row={row}
          laneCount={laneCount}
          selected={selected}
        />
        <div className="commit-copy">
          <div className="commit-subject-line">
            <span className="commit-subject">{row.commit.subject || '(no subject)'}</span>
            {row.refs.slice(0, 2).map((ref) => (
              <span className={`commit-ref ${ref.kind}`} key={ref.fullName}>{ref.shortName}</span>
            ))}
            {row.refs.length > 2 && <span className="commit-ref more">+{row.refs.length - 2}</span>}
          </div>
          <span className="commit-oid">{row.commit.shortOid}</span>
        </div>
      </div>
      <span className="commit-author" title={row.commit.authorEmail}>{row.commit.author}</span>
      <span className="commit-time" title={formatFullDate(row.commit.commitTime)}>{relativeTime(row.commit.commitTime)}</span>
    </button>
  )
})

function LaneConnections({ rows, laneCount }: { rows: readonly GraphRow[]; laneCount: number }): React.JSX.Element | null {
  const connections = useMemo(() => buildLaneConnections(rows), [rows])
  if (rows.length === 0) return null

  const width = laneCount * LANE_SPACING
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

function LaneGraph({ row, laneCount, selected }: {
  row: GraphRow
  laneCount: number
  selected: boolean
}): React.JSX.Element {
  const width = laneCount * LANE_SPACING
  const nodeX = row.lane * LANE_SPACING + LANE_SPACING / 2
  const nodeColor = laneColor(row.lane)
  return (
    <svg
      className="lane-graph lane-node-graph"
      width={width}
      viewBox={`0 0 ${width} ${LANE_ROW_HEIGHT}`}
      shapeRendering="geometricPrecision"
      aria-hidden="true"
    >
      {selected && <circle cx={nodeX} cy={LANE_NODE_Y} r="7" fill="none" stroke={nodeColor} strokeOpacity="0.45" strokeWidth="3" />}
      <circle
        cx={nodeX}
        cy={LANE_NODE_Y}
        r={row.refs.length > 0 || row.commit.parents.length > 1 ? 4.4 : 3.7}
        fill={nodeColor}
        stroke="#0d0f10"
        strokeWidth="1.2"
      />
    </svg>
  )
}

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]
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
 * Geometry rules per edge kind:
 * - `merge`: the merged branch attaches sideways right below the merge commit,
 *   then runs down the parent's column.
 * - `parent` changing lane: the ending branch keeps its own column (which the
 *   lane builder reserves as a tail) and curves into the parent at its row.
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
  const sourceX = edge.fromLane * LANE_SPACING + LANE_SPACING / 2
  const targetX = edge.toLane * LANE_SPACING + LANE_SPACING / 2
  const sourceY = sourceIndex * LANE_ROW_HEIGHT + LANE_NODE_Y
  const changesLane = edge.fromLane !== edge.toLane
  const sourceColor = laneColor(edge.fromLane)
  const targetColor = laneColor(edge.toLane)
  const stops: LaneGradientStop[] = []
  let path: string
  let targetY: number

  if (targetIndex === null) {
    targetY = bottomY
    const fadeStartY = Math.max(sourceY + LANE_NODE_Y, bottomY - FADE_OUT_ROWS * LANE_ROW_HEIGHT)
    if (changesLane && edge.kind === 'merge') {
      const curveEndY = Math.min(sourceY + LANE_NODE_Y, targetY)
      path = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + 11}, ${targetX} ${sourceY + 11}, ${targetX} ${curveEndY} L ${targetX} ${targetY}`
      stops.push(
        { offset: 0, opacity: 1, color: sourceColor },
        { offset: verticalOffset(curveEndY, sourceY, targetY), opacity: 1, color: targetColor },
        { offset: verticalOffset(fadeStartY, sourceY, targetY), opacity: 1, color: targetColor },
        { offset: 1, opacity: 0, color: targetColor }
      )
    } else {
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
      const curveEndY = Math.min(sourceY + LANE_NODE_Y, targetY)
      path = `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + 11}, ${targetX} ${sourceY + 11}, ${targetX} ${curveEndY} L ${targetX} ${targetY}`
      stops.push(
        { offset: 0, opacity: 1, color: sourceColor },
        { offset: verticalOffset(curveEndY, sourceY, targetY), opacity: 1, color: targetColor },
        { offset: 1, opacity: 1, color: targetColor }
      )
    } else {
      const curveStartY = Math.max(targetY - LANE_NODE_Y, sourceY)
      path = `M ${sourceX} ${sourceY} L ${sourceX} ${curveStartY} C ${sourceX} ${targetY - 11}, ${targetX} ${targetY - 11}, ${targetX} ${targetY}`
      stops.push(
        { offset: 0, opacity: 1, color: sourceColor },
        { offset: verticalOffset(curveStartY, sourceY, targetY), opacity: 1, color: sourceColor },
        { offset: 1, opacity: 1, color: targetColor }
      )
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
    strokeColor: targetColor,
    strokeWidth: edge.kind === 'merge' ? 2.25 : 2,
    stops
  }
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
