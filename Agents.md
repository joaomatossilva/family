# Agents Guide: Family Data Source

## File location

The application loads genealogy data from:

`public/family.json`

At runtime, the app fetches it using a relative path (`./family.json`), so this file is the single source of truth for the rendered tree.

## JSON schema

```json
{
  "people": [
    {
      "id": "string",
      "firstName": "string",
      "lastName": "string",
      "maidenName": "string (optional)",
      "birthDate": "YYYY-MM-DD",
      "deathDate": "YYYY-MM-DD | null",
      "notes": "string (optional)"
    }
  ],
  "relationships": [
    {
      "id": "string",
      "spouse1Id": "string (person id)",
      "spouse2Id": "string (person id)",
      "status": "married | divorced | partner",
      "childrenIds": ["string (person id)"]
    }
  ]
}
```

## Data integrity rules

1. `people[].id` values must be unique.
2. `relationships[].id` values must be unique.
3. Every `spouse1Id`, `spouse2Id`, and each value in `childrenIds` must match an existing `people[].id`.
4. `status` must be one of: `married`, `divorced`, `partner`.
5. Keep dates in ISO format (`YYYY-MM-DD`) in JSON; UI formatting is handled in the app.
6. Use `deathDate: null` for living people.
