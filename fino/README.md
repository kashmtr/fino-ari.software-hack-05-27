# Module Template Module

> **Template Module for ARI Module System**
> Use this as a reference when building your own modules

## Overview

This is a fully-featured example module demonstrating all capabilities of the ARI module system:
- ✅ Main page with authentication
- ✅ API routes with validation
- ✅ Database schema with RLS
- ✅ Dashboard widget
- ✅ Settings panel
- ✅ TypeScript types
- ✅ Comprehensive documentation

## Features Demonstrated

### 1. **Page Routing**
- Main module page at `/module-template`
- Uses ARI's authentication context
- Follows ARI's design patterns

### 2. **API Routes**
- GET endpoint for fetching data
- POST endpoint for creating data
- Authentication validation
- Zod schema validation
- Proper error handling

### 3. **Database Integration**
- Custom table: `module_template_entries`
- Drizzle ORM with `withRLS()` helper
- User-specific data isolation at application level
- Table defined in `/lib/db/schema/schema.ts`

### 4. **Dashboard Widget**
- Displays count of user's entries
- Follows ARI's card design system
- Handles loading states

### 5. **Settings Panel**
- Toggle settings
- Text input settings
- Proper state management
- Save/load functionality

### 6. **File Storage (ARI File Storage System)**
- Example upload endpoint in `api/upload/route.ts`
- Example file upload UI component in `components/file-upload-example.tsx`
- TanStack Query hooks: `useUploadFile()`, `useListFiles()`, `useDeleteFile()`
- Uses the central `/api/storage/` endpoints — no per-module storage setup needed
- See `hooks/use-module-template.ts` for the hook implementations

**Storage configuration:** the active backend is selected by `ARI_STORAGE_PROVIDER`
in `.env.local` (`filesystem` is the default if unset). Provider credentials
(`ARI_S3_*`, `ARI_R2_*`, `ARI_SUPABASE_S3_*`) also live in `.env.local`. Modules
do not configure storage themselves — `getStorageProvider(readStorageConfig())`
returns the right backend automatically. If your module needs provider-aware
behavior, read `process.env.ARI_STORAGE_PROVIDER` directly.

## Installation

This module is already installed in the `/modules` directory. To use it:

1. **Enable the module** in Settings → Features
2. **Apply database migrations** (see below)
3. **Navigate to** `/module-template` to see it in action

## Database Setup

### Required Tables

This module requires one database table: `module_template_entries`

### Automatic install on enable

`database/schema.sql` is executed automatically by the module loader every time the module is enabled. The script is fully idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS … CREATE POLICY …`), so re-enabling is a safe no-op. You do not need to paste the SQL into Supabase manually.

To ship a schema change in a module update, edit `schema.sql` additively (`ALTER TABLE … ADD COLUMN IF NOT EXISTS …`) and update `schema.ts` to match. The next enable will pick up the change.

### Manual uninstall

`database/uninstall.sql` is **never** run by the module loader. It exists only as a manual teardown script — open it in your SQL client of choice (Supabase Studio, pgweb, or `psql`) and run it yourself if you want to permanently drop this module's tables.

## File Structure

```
modules/module-template/
├── module.json                 # Module manifest (required)
├── README.md                   # This file
│
├── app/                        # Module pages (Next.js App Router)
│   └── page.tsx               # Main module page at /module-template
│
├── components/                 # Module components
│   ├── widget.tsx             # Dashboard widget
│   └── settings-panel.tsx     # Settings UI
│
├── api/                        # Module API routes
│   └── data/
│       └── route.ts           # API handlers at /api/modules-core/module-template/data
│
├── lib/                        # Module utilities
│   └── utils.ts               # Helper functions
│
├── database/                   # Database schemas
│   ├── schema.sql             # Auto-run on every module enable (idempotent)
│   ├── schema.ts              # Drizzle ORM definitions (runtime source of truth)
│   └── uninstall.sql          # MANUAL ONLY — never auto-runs
│
└── types/                      # TypeScript types
    └── index.ts               # Module type definitions
```

## Usage Examples

### Using the Module Page

Navigate to `/module-template` in your browser. The page shows:
- User information
- List of entries (from database)
- Form to create new entries

### Using the API

Authentication is handled via HTTP-only cookies (Better Auth), so no Authorization header is needed for browser requests.

```typescript
// From a React component - cookies are sent automatically
const response = await fetch('/api/modules/module-template/data')
const { entries } = await response.json()

// Create new entry
const response = await fetch('/api/modules/module-template/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'Hello from API' })
})
```

### Using TanStack Query Hooks (Recommended)

```typescript
import {
  useModuleTemplateEntries,
  useCreateModuleTemplateEntry,
  useDeleteModuleTemplateEntry,
} from '@/modules/module-template/hooks/use-module-template'

// In your component
const { data: entries = [], isLoading } = useModuleTemplateEntries()
const createEntry = useCreateModuleTemplateEntry()

// Create with optimistic updates
createEntry.mutate('My message')
```

### Using from Another Module

```typescript
// Import types
import { ModuleTemplateEntry } from '@/modules/module-template/types'

// Call the API (cookies handle auth automatically)
const response = await fetch('/api/modules/module-template/data')
const data = await response.json()
```

## Customization Guide

### Changing the Module Name

1. Update `id` in `module.json` (must be kebab-case)
2. Update `name` in `module.json` (display name)
3. Update route paths to match new ID
4. Rename database table prefix if desired
5. Update this README

### Adding More Pages

Create new pages in `/app`:
```
app/
├── page.tsx                    # Main page at /module-template
└── settings/
    └── page.tsx               # Sub-page at /module-template/settings
```

Update `module.json` routes:
```json
{
  "routes": [
    {
      "path": "/module-template",
      "label": "Module Template",
      "icon": "Package",
      "sidebarPosition": "main",
      "children": [
        {
          "path": "/module-template/settings",
          "label": "Settings",
          "icon": "Settings"
        }
      ]
    }
  ]
}
```

### Adding More API Endpoints

Create new route handlers in `/api`:
```
api/
├── data/
│   └── route.ts               # /api/modules/module-template/data
└── stats/
    └── route.ts               # /api/modules/module-template/stats
```

### Adding Database Tables

1. Add SQL to `database/schema.sql`
2. List table name in `module.json` under `database.tables`
3. Create migration file if updating existing module
4. Users apply migration via Settings → Features

### Adding npm Packages

If your module imports npm packages that aren't already in the host project's `package.json` (e.g., a charting library, a 3D engine), declare them in `module.json` under `npmDependencies`:

```json
{
  "npmDependencies": {
    "lodash": "^4.17.21",
    "three": "^0.184.0"
  }
}
```

When a user installs your module from `/modules`, the install flow:

- **Locally**: runs `pnpm add <pkg>@<ver> ...` against the host project root
- **On Vercel**: merges the entries into the user's root `package.json` and commits the update alongside your module files via GitHub. Vercel auto-rebuilds.

If a declared dep conflicts with a different version already in the host's `package.json` (e.g., your module wants `react@^18` but the host has `react@^19`), the install aborts safely before changing anything. Do **not** declare framework deps like `react`, `next`, or `react-dom` — those come from the host project.

The build-time validator (`scripts/generate-module-registry.js`, runs on `predev`/`prebuild`) warns when declared deps are missing from the host `package.json`, so authors notice drift early.

For the full spec — Vercel flow, conflict policy, security validation — see `docs/MODULES.md` § npm Dependencies.

## Development Workflow

### Testing Locally

```bash
# Start dev server
pnpm dev

# Visit http://localhost:3000/module-template
# Changes to files will hot-reload automatically
```

### Making Changes

1. **Code changes**: Hot-reload automatically
2. **Manifest changes**: Require page refresh
3. **Database changes**: Create migration file

### Debugging

Check browser console for:
- Authentication errors
- API request/response
- Component render errors

Check terminal for:
- Server-side errors
- API route logs
- Database query errors

## Best Practices Demonstrated

### ✅ Security
- All API routes validate authentication via `getAuthenticatedUser()`
- User data isolation via `withRLS()` helper (application-level RLS)
- Input validation with Zod
- Better Auth cookies (no token exposure in JavaScript)

### ✅ Performance
- TanStack Query for caching and deduplication
- Optimistic updates for instant UI feedback
- Lazy loading for components
- Loading states for async operations

### ✅ Code Quality
- TypeScript for type safety
- Comprehensive error handling
- Clear code comments
- Consistent naming conventions

### ✅ User Experience
- Loading indicators
- Error messages
- Empty states
- Responsive design

## Common Issues

### Module Not Showing in Sidebar
- Check `module.json` syntax (use JSON validator)
- Verify `routes` array is defined
- Restart dev server
- Check browser console for errors

### API Routes Returning 404
- Verify file path: `api/[route]/route.ts`
- Check `permissions.api: true` in manifest
- Clear `.next` folder: `rm -rf .next && pnpm dev`

### Database Errors
- Ensure migrations are applied
- Check RLS policies are enabled
- Verify Supabase connection
- Check user authentication

### Widget Not Appearing
- Check `dashboard.widgets: true` in manifest
- Verify widget component exports correctly
- Check dashboard code includes module widgets
- Restart dev server

## Testing Checklist

Before publishing your module, test:

- [ ] Module appears in sidebar
- [ ] Main page loads without errors
- [ ] Authentication redirects work
- [ ] API endpoints require auth
- [ ] API endpoints validate input
- [ ] Database tables created successfully
- [ ] RLS policies enforce user isolation
- [ ] Dashboard widget appears and loads data
- [ ] Settings panel saves/loads correctly
- [ ] Module can be disabled and re-enabled
- [ ] No console errors in browser or terminal

## Publishing Your Module

When ready to share:

1. Remove this module's specific content
2. Update README with your module's purpose
3. Add LICENSE file (MIT recommended)
4. Create git repository
5. Tag version (e.g., v1.0.0)
6. Share repository URL

## Support

For module development questions:
- See `/docs/MODULES.md` for the complete technical specification
- See `/docs/SECURITY.md` for the layered security model (middleware, withRLS, database RLS)
- Open issue in ARI repository

## License

This template is part of the ARI project and follows the same license.

---

**Happy Module Building! 🚀**
