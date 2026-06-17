# tocktest-back

## Docs pipeline & Tiptap content storage

The repository Docs feature follows this order on the frontend:

```
Docs pipeline (status box)
        ↓
Full Tiptap implementation (rich text editor)
        ↓
เขียนเอกสาร repository ด้วย markdown (Markdown source)
```

The backend stores doc content as **Markdown** (the Tiptap editor converts
Markdown <-> rich text on the client). No new entity/column was required, so the
deterministic AI Markdown generator and the rich editor share one storage format.

### API (`src/modules/docs`)

Base path: `/api/v1/repositories/:repoId/docs`

| Method | Path                | Purpose                                  |
|--------|---------------------|------------------------------------------|
| GET    | `/docs`             | Latest doc (Markdown `content`)          |
| PUT    | `/docs`             | Save edited content (creates new version)|
| GET    | `/docs/versions`    | Version history                          |
| GET    | `/docs/status`      | Pipeline status / staleness              |
| POST   | `/docs/gen`         | Full AI build                            |
| POST   | `/docs/refresh`     | Incremental refresh                      |
| POST   | `/docs/auto-update` | Auto update                              |
| DELETE | `/docs`             | Delete doc + reset pipeline state        |

`PUT /docs` is what the Tiptap editor saves to — it persists the Markdown
serialized from the editor.

### Validation / security / limits

- `UpdateDocDto.content`: `@IsString` + `@MaxLength(10_000_000)` guards oversized
  payloads (e.g. many base64 images).
- `main.ts` raises the JSON/urlencoded body limit to **12 MB** so inline base64
  images in rich-text docs are accepted.
- Content is stored verbatim as Markdown; the frontend Markdown parser disables
  raw HTML (`html: false`) to prevent injection when rendering.

### Database

Entity: `project_docs` (`src/modules/docs/entities/project-doc.entity.ts`) —
`content` (text, Markdown), `version`, `updatedBy`, timestamps. **No migration
needed** for the Tiptap integration.
