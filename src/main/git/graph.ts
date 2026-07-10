import type { CommitSummary, GitRef, GraphEdge, GraphModel, GraphRow } from '../../shared/contracts'

/**
 * A lane slot holds the OID of the commit expected further down that column.
 *
 * The primary slot is the column where that commit will render its node; a
 * non-primary slot is a reserved tail: a converging branch keeps its column
 * occupied until the parent's row so the renderer can run the branch line down
 * it without another branch reusing the column mid-flight.
 */
interface LaneSlot {
  oid: string
  primary: boolean
}

/**
 * @brief Produces a render-neutral lane layout for topologically ordered commits.
 *
 * Responsibility: assign stable lanes and parent connections once in the main
 * process so every renderer can remain a lightweight view of the same graph.
 */
export class GitGraphBuilder {
  build(commits: readonly CommitSummary[], refs: readonly GitRef[]): GraphModel {
    const refsByOid = new Map<string, GitRef[]>()
    for (const ref of refs) {
      const bucket = refsByOid.get(ref.displayOid) ?? []
      bucket.push(ref)
      refsByOid.set(ref.displayOid, bucket)
    }

    const lanes: Array<LaneSlot | null> = []
    const rows: GraphRow[] = []
    let maxLanes = 0

    commits.forEach((commit, rowIndex) => {
      const lane = this.takeLane(lanes, commit.oid)
      const firstParentOid = commit.parents[0] ?? null
      const firstParentLane = firstParentOid ? this.findPrimaryLane(lanes, firstParentOid) : -1

      if (firstParentOid === null) {
        lanes[lane] = null
      } else if (firstParentLane >= 0) {
        // Converging first parent: this branch ends at that parent, so hold the
        // column as a reserved tail until the parent's row is emitted.
        lanes[lane] = { oid: firstParentOid, primary: false }
      } else {
        lanes[lane] = { oid: firstParentOid, primary: true }
      }

      const edges: GraphEdge[] = commit.parents.map((parentOid, parentIndex) => {
        const parentLane = this.ensurePrimaryLane(lanes, parentOid)
        return {
          fromOid: commit.oid,
          toOid: parentOid,
          fromLane: lane,
          toLane: parentLane,
          colorIndex: parentLane % 8,
          kind: parentIndex > 0 ? 'merge' : 'parent'
        }
      })

      while (lanes.length > 0 && lanes.at(-1) === null) lanes.pop()
      maxLanes = Math.max(maxLanes, lanes.length, lane + 1)
      rows.push({
        commit,
        rowIndex,
        lane,
        refs: [...(refsByOid.get(commit.oid) ?? [])],
        edges,
        activeLanes: lanes.map((slot) => slot?.oid ?? null)
      })
    })

    return { rows, maxLanes }
  }

  /**
   * Returns the lane where this commit renders and releases every slot that
   * was waiting for it (its primary column plus any converging tails).
   */
  private takeLane(lanes: Array<LaneSlot | null>, oid: string): number {
    let claimed = -1
    for (let index = 0; index < lanes.length; index += 1) {
      const slot = lanes[index]
      if (slot?.oid !== oid) continue
      if (claimed < 0 || slot.primary) claimed = index
      lanes[index] = null
    }
    if (claimed >= 0) return claimed
    const free = lanes.indexOf(null)
    if (free >= 0) return free
    lanes.push(null)
    return lanes.length - 1
  }

  private findPrimaryLane(lanes: Array<LaneSlot | null>, oid: string): number {
    return lanes.findIndex((slot) => slot?.oid === oid && slot.primary)
  }

  private ensurePrimaryLane(lanes: Array<LaneSlot | null>, oid: string): number {
    const existing = this.findPrimaryLane(lanes, oid)
    if (existing >= 0) return existing
    const slot: LaneSlot = { oid, primary: true }
    const free = lanes.indexOf(null)
    if (free >= 0) {
      lanes[free] = slot
      return free
    }
    lanes.push(slot)
    return lanes.length - 1
  }
}
