# Family Tree (Static React App)

Interactive genealogy tree built with React + Vite + TypeScript.  
Runs fully client-side and reads data from a single JSON file: `public/family.json`.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start development server:
   ```bash
   npm run dev
   ```
3. Open the local URL shown in terminal (usually `http://localhost:5173`).

## Build for static hosting

```bash
npm run build
```

Build output is generated in `dist/` and is ready for static hosting (GitHub Pages, Netlify static, etc.).  
This project uses relative assets (`base: './'`) for subpath-friendly deployments.

## Data source management (`public/family.json`)

The app fetches data from `./family.json` at runtime.  
To update the tree, edit `public/family.json` and restart/reload the app.

### Schema

```json
{
  "people": [
    {
      "id": "p1",
      "firstName": "John",
      "lastName": "Doe",
      "maidenName": "Smith",
      "birthDate": "1980-01-01",
      "deathDate": null,
      "notes": "optional"
    }
  ],
  "relationships": [
    {
      "id": "r1",
      "spouse1Id": "p1",
      "spouse2Id": "p2",
      "status": "married",
      "childrenIds": ["p3", "p4"]
    }
  ]
}
```

### Rules for editing data

1. `id` values must be unique across each array.
2. `spouse1Id`, `spouse2Id`, and `childrenIds` must reference existing people IDs.
3. `status` must be one of: `married`, `divorced`, `partner`.
4. Dates should use ISO format in JSON (`YYYY-MM-DD`); UI renders as `DD/MM/YYYY`.
5. Use `deathDate: null` for living people.

### Notes about behavior

- Initial main tree anchor is chosen from the oldest `birthDate`.
- Search indexes: `firstName`, `lastName`, `maidenName`.
- Clicking a person scopes the tree to that branch; use **Return to Main Tree** to reset.
