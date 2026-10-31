# CampusPulse Firestore Database Schema & Architecture Notes
**Last updated:** 2026-10-31 — Reconciled with `netlify/functions/campus-ai.mjs` and `database/firestore.rules`

---

## Overview
CampusPulse persists structured campus events, user profiles, and personal academic tasks in Google Cloud Firestore.
Server-side access is mediated exclusively via the Firebase Admin SDK inside `netlify/functions/campus-ai.mjs`.
No client-side direct writes or credential leakage are permitted.

### Canonical Collection Names
1. **`events`**: Validated campus announcements, seminars, and workshops.
2. **`user_tasks`**: Private personal student tasks and academic deadline reminders (Canonical name reconciling previous `tasks` references).
3. **`users`**: Authenticated student profiles and roles.
4. **`summaries`**: Reserved for future persistent executive digests.

---

## Collections & Document Schemas

### 1. `events` Collection
**Exact Firestore collection name:** `events` (matches `db.collection('events')` in backend).

Primary collection holding validated campus events.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Authoritative Firestore document ID, always set server-side |
| `title` | `string` | Yes | Clear, concise event title — max 200 characters |
| `startDate` | `string` (ISO 8601) | Yes | Primary start timestamp (`YYYY-MM-DDTHH:MM:SS`). Stored as string, not Firestore Timestamp. |
| `endDate` | `string \| null` | No | Optional conclusion timestamp (`YYYY-MM-DDTHH:MM:SS`) |
| `startTime` | `string \| null` | No | Formatted 24-hr time (`HH:MM`) |
| `endTime` | `string \| null` | No | Optional end time (`HH:MM`) |
| `venue` | `string \| null` | No | Specific hall, department, room, or virtual link |
| `category` | `string` | No | One of: `academic`, `cultural`, `sports`, `career`, `workshop`, `club`, `general`. Defaults to `general`. |
| `description` | `string \| null` | No | Concise event overview — max 2,000 characters |
| `tags` | `array<string>` | No | Searchable keywords (e.g. `["hackathon", "coding", "cs-dept"]`) |
| `urgencyNote` | `string \| null` | No | Brief deadline or attendance requirement note |
| `rawSource` | `string \| null` | No | Original unstructured announcement text preserved for auditing |
| `status` | `string` | No | `published` \| `archived` \| `draft`. Defaults to `published`. |
| `createdAt` | `string` (ISO 8601) | Yes | Set server-side at first creation; never overwritten on updates |
| `updatedAt` | `string` (ISO 8601) | Yes | Set server-side on every successful write |

> **Not stored:** `priority` — this field is computed dynamically in `src/js/utils.js` (`classifyEventPriority`) based on the current date and time.

---

### 2. `user_tasks` Collection (Canonical Personal Tasks)
**Exact Firestore collection name:** `user_tasks` (matches `db.collection('user_tasks')` in `campus-ai.mjs` and all test suites).

Personal academic tasks, study reminders, and event-linked deadlines scoped strictly per student UID.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Authoritative document ID generated server-side |
| `userId` | `string` | Yes | Authenticated student UID (`request.auth.uid`). Immutable on update. |
| `title` | `string` | Yes | Task title / reminder heading — max 200 characters |
| `description` | `string` | No | Detailed student notes — max 2,000 characters |
| `dueDate` | `string \| null` | No | Target completion timestamp (ISO 8601) |
| `priority` | `string` | Yes | Task urgency enum: `low` \| `medium` \| `high` \| `urgent` |
| `completed` | `boolean` | Yes | Completion toggle state (`true` \| `false`) |
| `eventId` | `string \| null` | No | Optional foreign-key linkage to associated `events.id` |
| `createdAt` | `string` (ISO 8601) | Yes | Timestamp set on initial creation; immutable on updates |
| `updatedAt` | `string` (ISO 8601) | Yes | Updated automatically on every save/toggle |

---

### 3. `users` Collection
**Exact Firestore collection name:** `users`

Student profile records generated upon Google Sign-In or account initialization.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Matches user's unique Firebase Auth `uid` |
| `email` | `string` | Yes | Student email address |
| `displayName` | `string` | Yes | Full student name |
| `photoURL` | `string \| null` | No | Avatar URL |
| `role` | `string` | Yes | `student` \| `organizer` \| `admin` (defaults to `student`) |
| `createdAt` | `string` (ISO 8601) | Yes | Account creation timestamp |
| `updatedAt` | `string` (ISO 8601) | Yes | Last profile synchronization timestamp |

---

### 4. `summaries` Collection *(reserved — not yet implemented)*
Planned for a future phase. Weekly summaries are currently generated on demand by Gemini and returned to the client; they are not written to Firestore in this phase.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Formatted week key (e.g. `week_2026_w44`) |
| `title` | `string` | Summary heading |
| `summaryText` | `string` | Executive digest paragraph |
| `highlights` | `array<string>` | Bulleted key deadlines and events |
| `generatedAt` | `string` (ISO 8601) | Creation timestamp |

---

## Date Storage Format
All date and time values are stored as **ISO 8601 strings** (e.g. `2026-11-01T09:00:00`), **not** Firestore native `Timestamp` objects. This keeps client and server date handling uniform without requiring Timestamp deserialization on the frontend.

---

## Security Model
- **Reads**: 
  - `events`: Public read access to published events.
  - `user_tasks`: Restricted to the owning student (`userId == request.auth.uid`).
  - `users`: Restricted to the owning student (`request.auth.uid == userId`).
- **Writes/Updates**:
  - `events`: Client writes denied (`allow write: if false;`). Handled exclusively via backend serverless functions with admin authorization.
  - `user_tasks`: Handled via Netlify function (`save-task`, `delete-task`) with server-side UID token verification. Direct client rules also enforce ownership and immutable `userId`.
