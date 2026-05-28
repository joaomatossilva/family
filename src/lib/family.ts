import type { FamilyData, Person, Relationship } from '../types/family'

export interface FamilyIndexes {
  personById: Map<string, Person>
  relationshipsByPerson: Map<string, Relationship[]>
  parentsByChild: Map<string, Set<string>>
  childrenByPerson: Map<string, Set<string>>
  spousesByPerson: Map<string, Set<string>>
}

export const buildIndexes = (data: FamilyData): FamilyIndexes => {
  const personById = new Map(data.people.map((person) => [person.id, person]))
  const relationshipsByPerson = new Map<string, Relationship[]>()
  const parentsByChild = new Map<string, Set<string>>()
  const childrenByPerson = new Map<string, Set<string>>()
  const spousesByPerson = new Map<string, Set<string>>()

  for (const relationship of data.relationships) {
    for (const spouseId of [relationship.spouse1Id, relationship.spouse2Id]) {
      const existing = relationshipsByPerson.get(spouseId)
      if (existing) {
        existing.push(relationship)
      } else {
        relationshipsByPerson.set(spouseId, [relationship])
      }
    }

    if (!spousesByPerson.has(relationship.spouse1Id)) {
      spousesByPerson.set(relationship.spouse1Id, new Set())
    }
    if (!spousesByPerson.has(relationship.spouse2Id)) {
      spousesByPerson.set(relationship.spouse2Id, new Set())
    }
    spousesByPerson.get(relationship.spouse1Id)!.add(relationship.spouse2Id)
    spousesByPerson.get(relationship.spouse2Id)!.add(relationship.spouse1Id)

    for (const childId of relationship.childrenIds) {
      if (!parentsByChild.has(childId)) {
        parentsByChild.set(childId, new Set())
      }
      parentsByChild.get(childId)!.add(relationship.spouse1Id)
      parentsByChild.get(childId)!.add(relationship.spouse2Id)

      if (!childrenByPerson.has(relationship.spouse1Id)) {
        childrenByPerson.set(relationship.spouse1Id, new Set())
      }
      if (!childrenByPerson.has(relationship.spouse2Id)) {
        childrenByPerson.set(relationship.spouse2Id, new Set())
      }
      childrenByPerson.get(relationship.spouse1Id)!.add(childId)
      childrenByPerson.get(relationship.spouse2Id)!.add(childId)
    }
  }

  for (const personId of personById.keys()) {
    if (!relationshipsByPerson.has(personId)) relationshipsByPerson.set(personId, [])
    if (!parentsByChild.has(personId)) parentsByChild.set(personId, new Set())
    if (!childrenByPerson.has(personId)) childrenByPerson.set(personId, new Set())
    if (!spousesByPerson.has(personId)) spousesByPerson.set(personId, new Set())
  }

  return { personById, relationshipsByPerson, parentsByChild, childrenByPerson, spousesByPerson }
}

const normalizeDate = (value: string): Date => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? new Date('9999-12-31') : parsed
}

export const formatDate = (value: string | null): string => {
  if (!value) return 'Present'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const day = `${date.getDate()}`.padStart(2, '0')
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const year = date.getFullYear()
  return `${day}/${month}/${year}`
}

export const formatLifeRange = (person: Person): string =>
  `${formatDate(person.birthDate)} - ${formatDate(person.deathDate)}`

export const fullName = (person: Person): string => `${person.firstName} ${person.lastName}`

export const getOrderedSpouseIds = (personId: string, indexes: FamilyIndexes): string[] =>
  (indexes.relationshipsByPerson.get(personId) ?? [])
    .map((relationship) => (relationship.spouse1Id === personId ? relationship.spouse2Id : relationship.spouse1Id))
    .filter((spouseId, index, all) => all.indexOf(spouseId) === index)

export const getOldestPersonId = (people: Person[]): string | null => {
  if (people.length === 0) return null
  return [...people].sort((a, b) => normalizeDate(a.birthDate).getTime() - normalizeDate(b.birthDate).getTime())[0].id
}

export const buildMainSet = (rootId: string, indexes: FamilyIndexes): Set<string> => {
  const visible = new Set<string>([rootId])
  const descendants = collectDescendants(rootId, indexes)
  for (const personId of descendants) visible.add(personId)
  return visible
}

export const collectDescendants = (seed: string, indexes: FamilyIndexes): Set<string> => {
  const result = new Set<string>()
  const queue = [seed]

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const childId of indexes.childrenByPerson.get(current) ?? []) {
      if (result.has(childId)) continue
      result.add(childId)
      queue.push(childId)
    }
  }
  return result
}

export const buildScopedSet = (seed: string, indexes: FamilyIndexes): Set<string> => {
  const visible = new Set<string>([seed])
  const descendants = collectDescendants(seed, indexes)

  for (const personId of descendants) visible.add(personId)

  return visible
}
