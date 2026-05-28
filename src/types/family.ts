export type RelationshipStatus = 'married' | 'divorced' | 'partner'

export interface Person {
  id: string
  firstName: string
  lastName: string
  maidenName?: string
  birthDate: string
  deathDate: string | null
  notes?: string
}

export interface Relationship {
  id: string
  spouse1Id: string
  spouse2Id: string
  status: RelationshipStatus
  childrenIds: string[]
}

export interface FamilyData {
  people: Person[]
  relationships: Relationship[]
}
