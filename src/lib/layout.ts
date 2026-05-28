import { getOrderedSpouseIds, type FamilyIndexes } from './family'
import type { Person, Relationship } from '../types/family'

export type Orientation = 'vertical' | 'horizontal'

export interface NodeLayout {
  id: string
  x: number
  y: number
  width: number
  height: number
  generation: number
  order: number
}

export interface EdgePath {
  key: string
  d: string
  type: 'marriage' | 'descent'
}

export interface TreeLayout {
  nodes: Map<string, NodeLayout>
  edges: EdgePath[]
  width: number
  height: number
}

const CARD_WIDTH = 220
const CARD_MIN_HEIGHT = 112
const CARD_BASE_HEIGHT = 74
const CARD_SPOUSE_BLOCK_HEIGHT = 42
const GENERATION_GAP = 190
const SIBLING_GAP = 74
const ROOT_GAP = 120
const PADDING = 180

const dateOrder = (person: Person): number => {
  const date = new Date(person.birthDate)
  return Number.isNaN(date.getTime()) ? Number.MAX_SAFE_INTEGER : date.getTime()
}

const sortPeopleByBirth = (leftId: string, rightId: string, indexes: FamilyIndexes): number => {
  const left = indexes.personById.get(leftId)
  const right = indexes.personById.get(rightId)
  if (!left || !right) return leftId.localeCompare(rightId)
  const byDate = dateOrder(left) - dateOrder(right)
  if (byDate !== 0) return byDate
  return leftId.localeCompare(rightId)
}

const choosePrimaryParent = (
  parentIds: string[],
  generationById: Map<string, number>,
  indexes: FamilyIndexes,
): string => {
  return [...parentIds].sort((left, right) => {
    const leftGeneration = generationById.get(left) ?? 0
    const rightGeneration = generationById.get(right) ?? 0
    const byGeneration = leftGeneration - rightGeneration
    if (byGeneration !== 0) return byGeneration
    return sortPeopleByBirth(left, right, indexes)
  })[0]
}

const measureSubtreeSpan = (
  personId: string,
  childrenByParent: Map<string, string[]>,
  spanCache: Map<string, number>,
  breadthSize: number,
): number => {
  const cached = spanCache.get(personId)
  if (cached !== undefined) return cached

  const children = childrenByParent.get(personId) ?? []
  if (children.length === 0) {
    spanCache.set(personId, breadthSize)
    return breadthSize
  }

  const childSpan = children.reduce((acc, childId, index) => {
    const current = measureSubtreeSpan(childId, childrenByParent, spanCache, breadthSize)
    return acc + current + (index > 0 ? SIBLING_GAP : 0)
  }, 0)

  const span = Math.max(breadthSize, childSpan)
  spanCache.set(personId, span)
  return span
}

const assignSubtreeCenters = (
  personId: string,
  start: number,
  childrenByParent: Map<string, string[]>,
  spanCache: Map<string, number>,
  centers: Map<string, number>,
  breadthSize: number,
): void => {
  const span = spanCache.get(personId) ?? breadthSize
  centers.set(personId, start + span / 2)

  const children = childrenByParent.get(personId) ?? []
  if (children.length === 0) return

  const totalChildrenSpan = children.reduce((acc, childId, index) => {
    const childSpan = spanCache.get(childId) ?? breadthSize
    return acc + childSpan + (index > 0 ? SIBLING_GAP : 0)
  }, 0)

  let childCursor = start + (span - totalChildrenSpan) / 2
  for (const childId of children) {
    assignSubtreeCenters(childId, childCursor, childrenByParent, spanCache, centers, breadthSize)
    childCursor += (spanCache.get(childId) ?? breadthSize) + SIBLING_GAP
  }
}

const cardHeightForPerson = (personId: string, indexes: FamilyIndexes): number => {
  const spouseCount = getOrderedSpouseIds(personId, indexes).length
  return Math.max(CARD_MIN_HEIGHT, CARD_BASE_HEIGHT + spouseCount * CARD_SPOUSE_BLOCK_HEIGHT)
}

export const computeLayout = (
  visibleIds: Set<string>,
  rootId: string,
  indexes: FamilyIndexes,
  relationships: Relationship[],
  orientation: Orientation,
): TreeLayout => {
  const generationById = new Map<string, number>()
  const queue = [rootId]
  generationById.set(rootId, 0)

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentGeneration = generationById.get(current) ?? 0
    for (const childId of indexes.childrenByPerson.get(current) ?? []) {
      if (!visibleIds.has(childId)) continue
      const candidate = currentGeneration + 1
      const existing = generationById.get(childId)
      if (existing === undefined || candidate > existing) {
        generationById.set(childId, candidate)
        queue.push(childId)
      }
    }
  }

  for (const personId of visibleIds) {
    if (!generationById.has(personId)) generationById.set(personId, 0)
  }

  const parentByChild = new Map<string, string>()
  const childrenByParent = new Map<string, string[]>()

  for (const childId of visibleIds) {
    if (childId === rootId) continue
    const childGeneration = generationById.get(childId) ?? 0
    const candidates = [...(indexes.parentsByChild.get(childId) ?? [])].filter(
      (parentId) => visibleIds.has(parentId) && (generationById.get(parentId) ?? 0) === childGeneration - 1,
    )
    if (candidates.length === 0) continue

    const primaryParentId = choosePrimaryParent(candidates, generationById, indexes)
    parentByChild.set(childId, primaryParentId)
    const existing = childrenByParent.get(primaryParentId)
    if (existing) {
      existing.push(childId)
    } else {
      childrenByParent.set(primaryParentId, [childId])
    }
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    children.sort((left, right) => sortPeopleByBirth(left, right, indexes))
    childrenByParent.set(parentId, children)
  }

  const roots = [...visibleIds]
    .filter((personId) => !parentByChild.has(personId))
    .sort((left, right) => {
      if (left === rootId) return -1
      if (right === rootId) return 1
      const byGeneration = (generationById.get(left) ?? 0) - (generationById.get(right) ?? 0)
      if (byGeneration !== 0) return byGeneration
      return sortPeopleByBirth(left, right, indexes)
    })

  const cardHeightById = new Map<string, number>()
  for (const personId of visibleIds) {
    cardHeightById.set(personId, cardHeightForPerson(personId, indexes))
  }
  const maxCardHeight = Math.max(CARD_MIN_HEIGHT, ...cardHeightById.values())

  const breadthSize = orientation === 'vertical' ? CARD_WIDTH : maxCardHeight
  const spanCache = new Map<string, number>()
  for (const root of roots) measureSubtreeSpan(root, childrenByParent, spanCache, breadthSize)

  const breadthCenterById = new Map<string, number>()
  let rootCursor = 0
  roots.forEach((root, index) => {
    assignSubtreeCenters(root, rootCursor, childrenByParent, spanCache, breadthCenterById, breadthSize)
    rootCursor += (spanCache.get(root) ?? breadthSize) + (index < roots.length - 1 ? ROOT_GAP : 0)
  })

  const nodes = new Map<string, NodeLayout>()
  const orderedGenerations = [...new Set([...generationById.values()])].sort((a, b) => a - b)
  const generationMaxHeight = new Map<number, number>()
  for (const generation of orderedGenerations) {
    const maxHeight = [...visibleIds]
      .filter((personId) => (generationById.get(personId) ?? 0) === generation)
      .reduce((max, personId) => Math.max(max, cardHeightById.get(personId) ?? CARD_MIN_HEIGHT), CARD_MIN_HEIGHT)
    generationMaxHeight.set(generation, maxHeight)
  }
  const generationOffset = new Map<number, number>()
  let depthCursor = PADDING
  for (const generation of orderedGenerations) {
    generationOffset.set(generation, depthCursor)
    depthCursor += (orientation === 'vertical' ? generationMaxHeight.get(generation) ?? CARD_MIN_HEIGHT : CARD_WIDTH) + GENERATION_GAP
  }

  for (const personId of visibleIds) {
    const generation = generationById.get(personId) ?? 0
    const breadthCenter = breadthCenterById.get(personId) ?? 0
    const cardHeight = cardHeightById.get(personId) ?? CARD_MIN_HEIGHT
    const depthOffset = generationOffset.get(generation) ?? PADDING

    if (orientation === 'vertical') {
      nodes.set(personId, {
        id: personId,
        x: PADDING + breadthCenter - CARD_WIDTH / 2,
        y: depthOffset,
        width: CARD_WIDTH,
        height: cardHeight,
        generation,
        order: 0,
      })
    } else {
      nodes.set(personId, {
        id: personId,
        x: depthOffset,
        y: PADDING + breadthCenter - cardHeight / 2,
        width: CARD_WIDTH,
        height: cardHeight,
        generation,
        order: 0,
      })
    }
  }

  const generationOrderCounters = new Map<number, number>()
  const orderedByBreadth = [...nodes.values()].sort((left, right) => {
    if (left.generation !== right.generation) return left.generation - right.generation
    return orientation === 'vertical' ? left.x - right.x : left.y - right.y
  })
  for (const node of orderedByBreadth) {
    const nextOrder = generationOrderCounters.get(node.generation) ?? 0
    node.order = nextOrder
    generationOrderCounters.set(node.generation, nextOrder + 1)
  }

  const edges: EdgePath[] = []
  edges.push(...buildMarriagePaths(visibleIds, nodes, relationships, orientation))
  edges.push(...buildDescentPaths(visibleIds, nodes, relationships, orientation))

  let maxRight = 0
  let maxBottom = 0
  for (const node of nodes.values()) {
    maxRight = Math.max(maxRight, node.x + node.width)
    maxBottom = Math.max(maxBottom, node.y + node.height)
  }

  return {
    nodes,
    edges,
    width: maxRight + PADDING,
    height: maxBottom + PADDING,
  }
}

const buildMarriagePaths = (
  visibleIds: Set<string>,
  nodes: Map<string, NodeLayout>,
  relationships: Relationship[],
  orientation: Orientation,
): EdgePath[] => {
  const paths: EdgePath[] = []

  for (const relationship of relationships) {
    const left = nodes.get(relationship.spouse1Id)
    const right = nodes.get(relationship.spouse2Id)
    if (!left || !right) continue
    if (!visibleIds.has(left.id) || !visibleIds.has(right.id)) continue

    if (orientation === 'vertical') {
      const sorted = [left, right].sort((a, b) => a.x - b.x)
      const y = sorted[0].y + sorted[0].height / 2
      const x1 = sorted[0].x + sorted[0].width
      const x2 = sorted[1].x
      paths.push({
        key: `${relationship.id}-marriage`,
        d: `M ${x1} ${y} L ${x2} ${y}`,
        type: 'marriage',
      })
    } else {
      const sorted = [left, right].sort((a, b) => a.y - b.y)
      const x = sorted[0].x + sorted[0].width / 2
      const y1 = sorted[0].y + sorted[0].height
      const y2 = sorted[1].y
      paths.push({
        key: `${relationship.id}-marriage`,
        d: `M ${x} ${y1} L ${x} ${y2}`,
        type: 'marriage',
      })
    }
  }

  return paths
}

const buildDescentPaths = (
  visibleIds: Set<string>,
  nodes: Map<string, NodeLayout>,
  relationships: Relationship[],
  orientation: Orientation,
): EdgePath[] => {
  const paths: EdgePath[] = []
  const childLinksByParent = new Map<string, Set<string>>()

  for (const relationship of relationships) {
    const visibleParents = [relationship.spouse1Id, relationship.spouse2Id].filter(
      (parentId) => visibleIds.has(parentId) && nodes.has(parentId),
    )
    const visibleChildren = relationship.childrenIds.filter((childId) => visibleIds.has(childId) && nodes.has(childId))
    if (visibleParents.length === 0 || visibleChildren.length === 0) continue

    if (visibleParents.length === 1) {
      const parentId = visibleParents[0]
      if (!childLinksByParent.has(parentId)) childLinksByParent.set(parentId, new Set<string>())
      for (const childId of visibleChildren) childLinksByParent.get(parentId)!.add(childId)
      continue
    }

    for (const childId of visibleChildren) {
      const childNode = nodes.get(childId)!
      const selectedParentId = [...visibleParents].sort((leftId, rightId) => {
        const left = nodes.get(leftId)!
        const right = nodes.get(rightId)!
        const childAxis = orientation === 'vertical' ? childNode.x + childNode.width / 2 : childNode.y + childNode.height / 2
        const leftAxis = orientation === 'vertical' ? left.x + left.width / 2 : left.y + left.height / 2
        const rightAxis = orientation === 'vertical' ? right.x + right.width / 2 : right.y + right.height / 2
        const byDistance = Math.abs(childAxis - leftAxis) - Math.abs(childAxis - rightAxis)
        if (byDistance !== 0) return byDistance
        return leftId.localeCompare(rightId)
      })[0]

      if (!childLinksByParent.has(selectedParentId)) childLinksByParent.set(selectedParentId, new Set<string>())
      childLinksByParent.get(selectedParentId)!.add(childId)
    }
  }

  const parents = [...childLinksByParent.keys()]
    .map((parentId) => nodes.get(parentId))
    .filter((node): node is NodeLayout => Boolean(node))
    .sort((left, right) => {
      if (left.generation !== right.generation) return left.generation - right.generation
      return orientation === 'vertical' ? left.x - right.x : left.y - right.y
    })

  const laneByParentId = new Map<string, { lane: number; count: number }>()
  const parentsByGeneration = new Map<number, NodeLayout[]>()
  for (const parent of parents) {
    const group = parentsByGeneration.get(parent.generation)
    if (group) {
      group.push(parent)
    } else {
      parentsByGeneration.set(parent.generation, [parent])
    }
  }
  for (const group of parentsByGeneration.values()) {
    const count = group.length
    group.forEach((parent, lane) => laneByParentId.set(parent.id, { lane, count }))
  }

  for (const parent of parents) {
    const children = [...(childLinksByParent.get(parent.id) ?? new Set<string>())]
      .map((childId) => nodes.get(childId))
      .filter((node): node is NodeLayout => Boolean(node))
      .sort((left, right) => {
        if (left.generation !== right.generation) return left.generation - right.generation
        return orientation === 'vertical' ? left.x - right.x : left.y - right.y
      })

    if (children.length === 0) continue

    const laneMeta = laneByParentId.get(parent.id) ?? { lane: 0, count: 1 }

    if (orientation === 'vertical') {
      const parentX = parent.x + parent.width / 2
      const parentBottom = parent.y + parent.height
      const childXs = children.map((child) => child.x + child.width / 2)
      const minChildTop = Math.min(...children.map((child) => child.y))

      const minJoinY = parentBottom + 22
      const maxJoinY = minChildTop - 18
      let joinY = minJoinY
      if (maxJoinY > minJoinY) {
        const laneStep = (maxJoinY - minJoinY) / (laneMeta.count + 1)
        joinY = minJoinY + laneStep * (laneMeta.lane + 1)
      }

      paths.push({
        key: `${parent.id}-parent-trunk`,
        d: `M ${parentX} ${parentBottom} L ${parentX} ${joinY}`,
        type: 'descent',
      })

      const busStartX = Math.min(parentX, ...childXs)
      const busEndX = Math.max(parentX, ...childXs)
      paths.push({
        key: `${parent.id}-child-bus`,
        d: `M ${busStartX} ${joinY} L ${busEndX} ${joinY}`,
        type: 'descent',
      })

      for (const child of children) {
        const childX = child.x + child.width / 2
        paths.push({
          key: `${parent.id}-child-drop-${child.id}`,
          d: `M ${childX} ${joinY} L ${childX} ${child.y}`,
          type: 'descent',
        })
      }
    } else {
      const parentY = parent.y + parent.height / 2
      const parentRight = parent.x + parent.width
      const childYs = children.map((child) => child.y + child.height / 2)
      const minChildLeft = Math.min(...children.map((child) => child.x))

      const minJoinX = parentRight + 22
      const maxJoinX = minChildLeft - 18
      let joinX = minJoinX
      if (maxJoinX > minJoinX) {
        const laneStep = (maxJoinX - minJoinX) / (laneMeta.count + 1)
        joinX = minJoinX + laneStep * (laneMeta.lane + 1)
      }

      paths.push({
        key: `${parent.id}-parent-trunk`,
        d: `M ${parentRight} ${parentY} L ${joinX} ${parentY}`,
        type: 'descent',
      })

      const busStartY = Math.min(parentY, ...childYs)
      const busEndY = Math.max(parentY, ...childYs)
      paths.push({
        key: `${parent.id}-child-bus`,
        d: `M ${joinX} ${busStartY} L ${joinX} ${busEndY}`,
        type: 'descent',
      })

      for (const child of children) {
        const childY = child.y + child.height / 2
        paths.push({
          key: `${parent.id}-child-drop-${child.id}`,
          d: `M ${joinX} ${childY} L ${child.x} ${childY}`,
          type: 'descent',
        })
      }
    }
  }

  return paths
}
