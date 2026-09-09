# Software Requirements Specification (SRS)
## Project: Second Brain — Personal Knowledge Capture & Retrieval System

**Version:** 1.0 (MVP)
**Status:** Draft for Development
**Date:** September 09, 2026
**Project Lead:** Sourav Giri
**Developer:** Ritesh Deshmukh

---

## 1. Introduction

### 1.1 Purpose
This document specifies the functional and non-functional requirements for **Second Brain**, a multi-user web application that lets users save content from the internet (articles, tweets, images, YouTube videos, PDFs) and automatically organizes it into a searchable, taggable personal knowledge base.

This SRS defines the **MVP (v1.0)** scope only. Advanced intelligence features (AI auto-tagging, topic clustering, knowledge graph visualization, memory resurfacing) are explicitly deferred to Phase 2 and are documented under Out of Scope (Section 10).

### 1.2 Scope
**In scope for MVP:**
- Multi-user account system (email/password + Google OAuth)
- Manual content saving (URL/article, PDF upload, image upload, tweet link, YouTube video link)
- Automatic metadata extraction for saved content (title, description, thumbnail, source)
- Manual tagging and Collections (user-organized folders/groups)
- Highlight system (users can highlight text within saved articles)
- Hybrid search: keyword search + semantic (embedding-based) search
- Basic per-user data isolation and security

**Out of scope for MVP** (see Section 10 for full list):
- Browser extension
- AI-driven auto-tagging and topic clustering
- Knowledge graph visualization
- Memory resurfacing ("2 months ago you saved this")
- Admin analytics dashboard
- Enterprise SSO / multi-tenancy

### 1.3 Definitions & Acronyms
| Term | Definition |
|---|---|
| Item | A single saved piece of content (article, PDF, image, tweet, or video) |
| Collection | A user-defined group of Items (similar to a folder) |
| Highlight | A user-selected text snippet within an Item, saved for later reference |
| Embedding | A vector representation of text content used for semantic similarity search |
| MVP | Minimum Viable Product — the v1.0 release scope defined in this document |
| RBAC | Role-Based Access Control |
| p95 | 95th percentile — 95% of requests complete within this time |

### 1.4 Intended Audience
Backend engineers, frontend engineers, QA engineers, and the product owner responsible for building and validating v1.0 of Second Brain.

### 1.5 References
- Project idea brief (provided by stakeholder, September 2026)
- Decisions log — Section 11 of this document

---

## 2. Product Overview

### 2.1 System Overview
Second Brain is a web application where a logged-in user saves content via manual input (paste URL, upload PDF/image, or paste a tweet/YouTube link). The system extracts metadata, stores the content, generates a semantic embedding, and makes the item available for keyword and semantic search. Users organize items into Collections, apply tags, and highlight text within saved articles/PDFs.

### 2.2 Users & Roles
| Role | Description |
|---|---|
| User | Authenticated individual who owns and manages their own saved Items, Collections, Tags, and Highlights. All data is strictly scoped to the owning user — no cross-user visibility in MVP. |

### 2.3 Major Features (MVP)
1. Account creation & login (Email/Password, Google OAuth)
2. Save Item (URL, PDF, image, tweet link, YouTube link)
3. Automatic metadata extraction (title, thumbnail, source, content type)
4. Manual tagging
5. Collections (create, add/remove items, rename, delete)
6. Highlight system (text-level highlights on articles/PDFs)
7. Hybrid Search (keyword + semantic)
8. Item management (view, edit metadata, delete)

### 2.4 System Context
```
User (Browser)
   │
   ▼
Frontend (React/Next.js)
   │  (HTTPS/REST)
   ▼
Backend API (Node.js)
   │
   ├──► MongoDB (users, items, collections, tags, highlights — document store)
   │        └──► Atlas Vector Search (embeddings stored + indexed within MongoDB)
   ├──► Object Storage (S3-compatible) — PDFs, images, thumbnails
   ├──► Job Queue (RabbitMQ) ──► Node.js Worker (same codebase/language as API)
   │                                 ├──► Content extraction (URL/PDF parsing)
   │                                 └──► Embedding generation (External LLM API call, result written to MongoDB)
   └──► Google OAuth (external identity provider)
```

### 2.5 External Systems / Services
- **External LLM/Embedding API** (e.g., Gemini) — for generating text embeddings used in semantic search
- **Google OAuth2** — for social login
- **URL content extraction** — fetching and parsing external web pages (readability-style extraction)
- **S3-compatible object storage** — for PDF/image file storage

---

## 3. Functional Requirements

### 3.1 Authentication

**FR-AUTH-001 — User Registration (Email/Password)**
- **Preconditions:** None
- **Input:** email, password, (optional) display name
- **Behavior:** Validate email format and uniqueness; enforce password policy (min. 8 characters, at least 1 letter + 1 number); hash password using bcrypt before storage.
- **Output:** New user account created; verification email sent; user redirected to "verify your email" state.
- **Edge cases:**
  - Email already registered → `409 Conflict`, message "Account already exists"
  - Weak password → `400 Bad Request` with specific policy violation
  - Malformed email → `400 Bad Request`
- **Acceptance criteria:** Given a unique, valid email and a policy-compliant password, a new unverified account is created and a verification email is sent within 30 seconds.

**FR-AUTH-002 — Email Verification**
- **Input:** verification token (from emailed link)
- **Behavior:** Token validated against stored token + expiry (24 hours). On success, account marked verified.
- **Edge cases:** Expired token → `410 Gone`, option to resend; invalid/tampered token → `400 Bad Request`.
- **Acceptance criteria:** Valid, unexpired token verifies the account and allows login.

**FR-AUTH-003 — Login (Email/Password)**
- **Input:** email, password
- **Behavior:** Validate credentials; if valid and account verified, issue JWT access token (15 min expiry) + refresh token (7 days expiry, httpOnly cookie).
- **Edge cases:**
  - Invalid credentials → `401 Unauthorized`, generic message (no "email not found" vs "wrong password" distinction, to prevent user enumeration)
  - Unverified account → `403 Forbidden`, "please verify your email"
  - Account locked after 5 failed attempts within 15 minutes → `429 Too Many Requests`, locked for 15 minutes
- **Acceptance criteria:** Valid, verified credentials return a valid JWT within 1 second (p95).

**FR-AUTH-004 — Google OAuth Login**
- **Input:** Google OAuth2 authorization code
- **Behavior:** Exchange code for Google profile; create account if first login (auto-verified), else log in existing linked account.
- **Edge cases:** Email already exists via password signup → link accounts only after explicit user confirmation (prevent silent account takeover); Google API failure → `502 Bad Gateway`, user-facing "try again" message.
- **Acceptance criteria:** New Google users are onboarded without a password step; returning users are logged in within 2 seconds (p95).

**FR-AUTH-005 — Token Refresh**
- **Input:** refresh token (httpOnly cookie)
- **Behavior:** Validate refresh token; issue new access token. Rotate refresh token on each use.
- **Edge cases:** Expired/revoked refresh token → `401 Unauthorized`, force re-login.

**FR-AUTH-006 — Logout**
- **Behavior:** Revoke refresh token server-side; clear client-side tokens.

---

### 3.2 Content Saving

**FR-SAVE-001 — Save URL/Article**
- **Preconditions:** User authenticated
- **Input:** URL (string)
- **Behavior:** Validate URL format; enqueue async extraction job; return item in `processing` state immediately. Extraction fetches page, extracts title, main text content, canonical thumbnail, and source domain.
- **Output:** Item record created with status `processing` → updates to `ready` or `failed`.
- **Edge cases:**
  - Invalid URL → `400 Bad Request`
  - URL unreachable / times out (>10s) → item status `failed`, reason `"Unable to fetch content"`, user notified in UI
  - Paywalled/blocked content → item saved with URL + whatever partial metadata is available, status `partial`
  - Duplicate URL already saved by same user → warn user, offer to view existing item instead of creating duplicate
- **Acceptance criteria:** A valid, reachable URL results in a `ready` item with title, thumbnail, and extracted text within 30 seconds (p95).

**FR-SAVE-002 — Save PDF**
- **Input:** PDF file upload (max 50MB)
- **Behavior:** Validate file type (`application/pdf`) and size; store in object storage; extract text content and title (from metadata or first page) via async job.
- **Edge cases:**
  - File >50MB → `413 Payload Too Large`
  - Corrupted/unreadable PDF → item saved with status `failed`, reason `"Could not parse PDF"`
  - Password-protected PDF → status `failed`, reason `"Password-protected file not supported"`
- **Acceptance criteria:** Valid PDF ≤50MB is stored and text-extracted within 60 seconds (p95).

**FR-SAVE-003 — Save Image**
- **Input:** Image file upload (max 10MB; formats: JPEG, PNG, WEBP)
- **Behavior:** Validate type/size; store in object storage; generate thumbnail.
- **Edge cases:** Unsupported format → `400 Bad Request`; file >10MB → `413 Payload Too Large`.

**FR-SAVE-004 — Save Tweet (link-based)**
- **Input:** Tweet/X post URL
- **Behavior:** Validate URL matches expected domain pattern; fetch embeddable metadata (author, text, timestamp) via oEmbed where available.
- **Edge cases:** Tweet deleted/private/unavailable → item saved with status `failed`, reason `"Post unavailable"`.

**FR-SAVE-005 — Save YouTube Video (link-based)**
- **Input:** YouTube URL
- **Behavior:** Validate URL; fetch title, thumbnail, channel name, duration via oEmbed/public metadata. Video is **not** downloaded or re-hosted — only the link and metadata are stored.
- **Edge cases:** Invalid/private/deleted video → status `failed`, reason `"Video unavailable"`.

**FR-SAVE-006 — Embedding Generation (all Item types)**
- **Behavior:** Once text content is available (extracted article text, PDF text, tweet text, or video title/description), an async job (via RabbitMQ) sends the content to the external embedding API and writes the resulting vector back into the Item's document in MongoDB, where it is indexed by Atlas Vector Search.
- **Edge cases:** Embedding API failure/timeout → retry up to 3 times with exponential backoff; after final failure, item remains searchable via keyword search only, flagged `embedding_failed` (does not block item usability).

---

### 3.3 Organization

**FR-ORG-001 — Manual Tagging**
- **Input:** Item ID, tag name(s)
- **Behavior:** User adds one or more free-text tags to an Item. Tags are user-scoped (not shared across users).
- **Edge cases:** Duplicate tag on same item → ignored silently (idempotent); tag name >50 characters → `400 Bad Request`.
- **Acceptance criteria:** Tags applied are immediately visible and filterable in the item list.

**FR-ORG-002 — Create Collection**
- **Input:** Collection name
- **Behavior:** Creates a named, user-scoped Collection.
- **Edge cases:** Duplicate collection name for same user → allowed (not unique-constrained) but UI warns; name >100 chars → `400 Bad Request`.

**FR-ORG-003 — Add/Remove Item to/from Collection**
- **Behavior:** An Item can belong to multiple Collections simultaneously (many-to-many).
- **Edge cases:** Adding same item twice → idempotent, no duplicate association.

**FR-ORG-004 — Rename/Delete Collection**
- **Edge cases:** Deleting a Collection does **not** delete the Items inside it — only the grouping association is removed.

---

### 3.4 Highlights

**FR-HL-001 — Create Highlight**
- **Preconditions:** Item has extracted text content (status `ready` or `partial`)
- **Input:** Item ID, selected text span (start/end offsets), optional user note
- **Behavior:** Stores the highlighted span linked to the item.
- **Edge cases:** Highlight requested on item with no text content (e.g., pure image) → `400 Bad Request`, "Highlighting not supported for this item type."

**FR-HL-002 — View/Delete Highlight**
- **Behavior:** Highlights are listed per-item and are user-owned (deletable only by creator).

---

### 3.5 Search

**FR-SEARCH-001 — Keyword Search**
- **Input:** Search query string
- **Behavior:** Full-text search across item title, extracted content, and tags (scoped to the requesting user's items only).
- **Edge cases:** Empty query → `400 Bad Request`; no results → `200 OK` with empty array, not an error.
- **Acceptance criteria:** Results returned within 500ms (p95) for a user with up to 10,000 saved items.

**FR-SEARCH-002 — Semantic Search**
- **Input:** Search query string
- **Behavior:** Query is embedded via the same external embedding API and compared against stored item vectors using cosine similarity; top-N results returned ranked by similarity score.
- **Edge cases:** Embedding API unavailable → gracefully fall back to keyword-only search, with a non-blocking notice to the user; items flagged `embedding_failed` (from FR-SAVE-006) are excluded from semantic results but remain in keyword results.
- **Acceptance criteria:** Results returned within 1.5s (p95).

**FR-SEARCH-003 — Combined/Hybrid Results**
- **Behavior:** Search endpoint returns a merged, de-duplicated result set combining keyword and semantic matches, with keyword-exact-title matches ranked first.

---

### 3.6 Item Management

**FR-ITEM-001 — View Item**
- Returns full item detail: metadata, extracted content, tags, collections, highlights.

**FR-ITEM-002 — Edit Item Metadata**
- User can manually override auto-extracted title.

**FR-ITEM-003 — Delete Item**
- **Behavior:** Soft-delete (item hidden from all views, excluded from search) for 30 days, then permanently purged (data + object storage file + vector entry) by a scheduled job.
- **Edge cases:** Deleting an item removes it from all Collections and deletes its Highlights (cascade), after the 30-day grace period.

---

## 4. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | API p95 response time ≤ 300ms for read endpoints (excluding search/save); Search endpoints per Section 3.5 targets. |
| **Scalability** | System must support up to 50,000 registered users and 5 million total items in MVP without architectural redesign (horizontal scaling of API and worker layers). |
| **Availability** | 99.5% uptime target for the API (excludes scheduled maintenance windows, announced 48h in advance). |
| **Reliability** | Async job failures (extraction, embedding) must retry automatically (max 3 attempts, exponential backoff) and never silently lose the underlying saved Item. |
| **Maintainability** | API service and background worker (both Node.js) must be independently deployable and scalable, decoupled via RabbitMQ — not direct function calls. |
| **Observability** | All API requests logged with request ID, user ID (if authenticated), status code, and latency. All async job outcomes (success/failure/retry) logged with job ID and item ID. |
| **Data Integrity** | Item deletion, tag/collection association changes must be atomic (no orphaned references). |
| **Accessibility** | Frontend must meet WCAG 2.1 Level AA for core flows (save, search, view item). |
| **Compatibility** | Latest 2 stable versions of Chrome, Firefox, Safari, Edge (desktop); responsive layout for tablet/mobile web (no native app in MVP). |

---

## 5. Security Requirements

- **Authentication:** JWT-based (15 min access token, 7-day rotating refresh token, httpOnly + Secure + SameSite=Strict cookies for refresh token).
- **Authorization:** Strict per-user data isolation — every query filtered by `owner_user_id`; no endpoint may return another user's data under any input (verified via automated authorization tests).
- **Password Policy:** Minimum 8 characters, at least 1 letter + 1 number; bcrypt hashing (cost factor ≥ 12).
- **Session/Token Management:** Refresh tokens rotated on each use; old token invalidated (reuse detection triggers full session revocation as a compromise signal).
- **Encryption:** TLS 1.2+ enforced for all traffic; data encrypted at rest in database and object storage.
- **Secrets Management:** API keys (LLM provider, OAuth client secret, DB credentials) stored in a secrets manager / environment-injected — never committed to source control.
- **Input Validation:** All user input validated server-side (type, length, format) regardless of client-side validation.
- **Rate Limiting:** Login endpoint — 5 attempts / 15 min / IP+account combo; Save endpoints — 60 requests / minute / user; Search endpoints — 30 requests / minute / user.
- **CSRF/CORS:** CORS restricted to known frontend origin(s); CSRF protection on cookie-based refresh flow.
- **Injection Protection:** Parameterized queries only (no raw SQL string concatenation); uploaded files scanned for type-spoofing (magic-byte validation, not just extension/MIME header trust).
- **PII Handling:** Email is the only PII collected in MVP; not shared with third parties except the OAuth provider (Google) and embedding API (content text only, no user PII sent to LLM API beyond the content itself).
- **Audit Logging:** Authentication events (login, failed login, password reset) logged with timestamp and IP (retained 90 days).

---

## 6. Data Requirements

### 6.1 Core Collections (MongoDB — Document Model)

Database: **MongoDB**. Each entity below is a top-level collection. Relationships that would be joins in a relational model are instead handled via **referenced ObjectIds** (not embedded documents), since Items/Tags/Collections/Highlights are independently queried, updated, and deleted.

| Collection | Key Fields |
|---|---|
| `users` | `_id`, `email` (unique index), `password_hash` (nullable if OAuth-only), `display_name`, `auth_provider`, `verified`, `created_at` |
| `items` | `_id`, `owner_user_id` (ref → users, indexed), `type` (url/pdf/image/tweet/video), `source_url`, `title`, `extracted_text`, `thumbnail_url`, `storage_path` (nullable), `status` (processing/ready/partial/failed), `tag_ids` (array of refs), `embedding` (array of floats, nullable — indexed via Atlas Vector Search), `embedding_status` (pending/ready/failed), `created_at`, `deleted_at` (nullable) |
| `tags` | `_id`, `owner_user_id` (indexed), `name` |
| `collections` | `_id`, `owner_user_id` (indexed), `name`, `item_ids` (array of refs), `created_at` |
| `highlights` | `_id`, `item_id` (ref, indexed), `owner_user_id` (indexed), `text_span`, `start_offset`, `end_offset`, `note` (nullable), `created_at` |

**Note on embeddings:** Unlike the earlier design (separate `Embedding` entity/service), the vector is stored **directly on the `items` document** as an `embedding` field, indexed by **MongoDB Atlas Vector Search**. This removes the need for a separate vector database or sync process — semantic search queries run natively against the `items` collection.

**Note on tags/collections association:** Modeled as reference arrays (`item.tag_ids`, `collection.item_ids`) rather than a separate junction collection — standard MongoDB pattern for many-to-many at this scale. Both sides indexed for query performance (e.g., "all items with tag X" and "all tags on item Y").

### 6.2 Constraints
- Every query on `items`, `tags`, `collections`, `highlights` must filter by `owner_user_id` — enforced at the API/service layer (MongoDB has no native row-level security like Postgres RLS, so this is a mandatory application-level rule, tested explicitly per Section 5).
- `items.deleted_at` — soft delete marker; a daily scheduled job permanently removes documents with `deleted_at` older than 30 days, including associated object storage files. Because `embedding` lives inside the `items` document, deleting the document also removes it from the vector index — no separate vector-store cleanup step needed.
- Referential cleanup: deleting an Item must also remove its `_id` from any `collections.item_ids` arrays and delete associated `highlights` documents (handled via application-level cascade, since MongoDB has no native foreign-key cascade).

### 6.3 Data Retention & Backup
- Active user data retained indefinitely until account deletion.
- Deleted items: 30-day soft-delete grace period, then permanent purge.
- Database backups: daily automated snapshots, retained 30 days.
- Account deletion (user-initiated): all data purged within 30 days, except audit/security logs retained per Section 5.

---

## 7. API Requirements (Key Endpoints)

| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| POST | `/api/v1/auth/register` | No | FR-AUTH-001 |
| POST | `/api/v1/auth/login` | No | FR-AUTH-003 |
| POST | `/api/v1/auth/google` | No | FR-AUTH-004 |
| POST | `/api/v1/auth/refresh` | Refresh token | FR-AUTH-005 |
| POST | `/api/v1/items` | Yes | Save new item (FR-SAVE-001–005); body varies by `type` |
| GET | `/api/v1/items` | Yes | List/filter items (by tag, collection, status) |
| GET | `/api/v1/items/{id}` | Yes | FR-ITEM-001 |
| PATCH | `/api/v1/items/{id}` | Yes | FR-ITEM-002 |
| DELETE | `/api/v1/items/{id}` | Yes | FR-ITEM-003 (soft delete) |
| POST | `/api/v1/items/{id}/highlights` | Yes | FR-HL-001 |
| POST | `/api/v1/collections` | Yes | FR-ORG-002 |
| POST | `/api/v1/collections/{id}/items` | Yes | FR-ORG-003 |
| GET | `/api/v1/search?q=` | Yes | FR-SEARCH-001–003 |

All authenticated endpoints require `Authorization: Bearer <access_token>` header. Standard error responses: `400` (validation), `401` (auth), `403` (forbidden), `404` (not found), `413` (payload too large), `429` (rate limit), `500`/`502` (server/upstream error).

---

## 8. Error Handling (Global Patterns)

- All API errors return a consistent JSON shape: `{ "error": { "code": string, "message": string } }`.
- Async job failures never delete the underlying user-submitted data — item is preserved with a `failed`/`partial` status and a human-readable reason surfaced in the UI.
- Third-party API failures (embedding, OAuth, URL fetch) trigger retry with exponential backoff (3 attempts); on exhaustion, feature degrades gracefully rather than blocking the core save action.
- Client-facing error messages never expose internal stack traces, DB errors, or third-party raw error payloads.

---

## 9. Constraints & Assumptions

**Constraints:**
- Cloud-agnostic deployment preferred, with one accepted exception: **MongoDB Atlas Vector Search** is specific to MongoDB's managed Atlas offering (not available on fully self-hosted MongoDB). This is a deliberate trade-off to avoid running a separate vector database — self-hosted MongoDB remains usable for everything except semantic search if the team later moves off Atlas.
- External LLM/embedding API dependency — system must remain partially functional (keyword search) if this dependency is down.
- No native mobile app in MVP; responsive web only.

**Assumptions:**
- Users have a modern browser with JavaScript enabled.
- Expected initial load: up to ~50,000 users, ~5M items (per NFR Section 4).
- YouTube/Tweet metadata fetched via public oEmbed endpoints; no official paid API partnership assumed for MVP.
- Users are individuals (not organizations) — no team/shared-workspace concept in MVP.

---

## 10. Out of Scope (MVP)

Explicitly **excluded** from this SRS / v1.0 release:
- Browser extension (save-from-anywhere)
- AI-driven automatic tagging suggestions
- Topic clustering / knowledge graph visualization (d3.js graph view)
- Memory resurfacing ("N days ago you saved this")
- Admin analytics dashboard
- Enterprise SSO
- Multi-tenancy / team workspaces
- Native mobile applications
- Offline mode / local-first sync
- Video file re-hosting (videos remain link-only, embedded via source platform)

These are candidates for Phase 2 and will require a separate SRS addendum.

---

## 11. Acceptance Criteria / Definition of Done (MVP)

The MVP is considered feature-complete when:
1. All Functional Requirements in Section 3 pass their stated acceptance criteria.
2. All NFR targets in Section 4 are met under a defined load test (up to 1,000 concurrent users, synthetic dataset of 100,000 items).
3. All Security Requirements in Section 5 pass a security review checklist, including an authorization test suite confirming no cross-user data leakage.
4. Core user flow — register → save 5 different item types → tag/collection organize → highlight → keyword search → semantic search → delete — is verified end-to-end without manual intervention.

---

## 12. Decisions Log (Reference)

| Decision | Choice |
|---|---|
| User model | Multi-user, authenticated |
| MVP scope philosophy | Core-first (save, organize, search); AI intelligence features → Phase 2 |
| Content types in MVP | All 5 types (URL, PDF, image, tweet, video) |
| Browser extension | Phase 2 |
| Search | Hybrid (keyword + semantic) in MVP |
| AI/embedding provider | External LLM API |
| Auth methods | Email/Password + Google OAuth |
| Collections & Highlights | Included in MVP |
| Infra | Cloud-agnostic (S3-compatible object storage) |
| Roles | Single `User` role, strict data isolation |
| Backend language | Node.js only — no separate Python service; API + worker both Node.js |
| Job queue | RabbitMQ (replaces earlier Redis-backed queue) |
| Primary database | MongoDB (document model, replaces earlier PostgreSQL) |
| Vector search | MongoDB Atlas Vector Search — embedding stored on the `items` document itself, no separate vector DB |

---

*End of Document*
