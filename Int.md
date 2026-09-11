# Second Brain — Interview Prep & Architecture Notes

This doc has two parts:
1. **RAG deep-dive** — the mental model, so you understand *why* each step exists, not just the pipeline order.
2. **55 interview questions** across categories, each with what the interviewer is actually probing for and the core point your answer needs to hit. Don't memorize the answers — memorize the *reasoning path*, so you can rebuild the answer even if the question is phrased differently.

---

## Part 1: RAG — the real mental model

Forget the pipeline diagram for a second. RAG exists to solve **one specific problem**: an LLM only knows what it was trained on (general internet text up to some cutoff) — it has never seen *your* saved article from last Tuesday. Two ways to fix that:

- **Fine-tuning** — retrain the model on your data. Expensive, slow, and you'd have to retrain every time you save something new. Bad fit.
- **RAG** — at question time, *search* your data, find the relevant pieces, and paste them into the prompt as context. The model never "learns" your data — it just reads the relevant slice fresh, every time. Cheap, instant, always up to date.

So RAG = **open-book exam** instead of "memorize the textbook." The LLM answers using what's put in front of it, not what it memorized.

### Why chunk instead of sending the whole document?
Two reasons: (1) token limits — a 30-page PDF might exceed what fits in one prompt; (2) **signal dilution** — if you send 30 pages and the answer is in one paragraph, the model has to find a needle in a haystack, and retrieval quality drops. Small, focused chunks let you retrieve *just* the relevant paragraph, not the whole document.

### Why embeddings instead of keyword search?
Keyword search (`LIKE '%redis%'`) only matches exact words. If your notes say "in-memory data store" but you ask about "Redis," keyword search misses it — no shared words, same meaning. Embeddings convert text into coordinates in a "meaning space" where semantically similar text ends up near each other, regardless of exact wording. This is the single biggest upgrade RAG gives you over a normal search bar.

### Why retrieve only top-5, not top-50?
This is a **precision vs. cost/noise tradeoff**. Every extra chunk you send: (1) costs more tokens → more money, (2) increases the chance of irrelevant context confusing the model ("lost in the middle" problem — LLMs pay less attention to the middle of a long context), (3) slows down response time. Top-5 is a starting heuristic; production systems tune this number empirically by measuring answer quality at different k values.

### What's "grounding" and why does it matter?
Grounding = the answer is *derived from* the retrieved context, not the model's general training knowledge. Without RAG, if you ask "what does Redis do for rate limiting," the LLM answers from generic internet knowledge — could be right, could hallucinate, and definitely isn't personalized to *your* notes. With RAG, the system prompt literally says "answer using only this context" — this is what makes it "grounded" and reduces hallucination.

### The failure mode you must be able to discuss: irrelevant retrieval
If your embedding/chunking is bad, you retrieve the *wrong* 5 chunks, and the LLM confidently answers using irrelevant context — worse than no context at all, because it sounds authoritative. This is why retrieval quality (not the LLM) is usually the actual bottleneck in RAG systems, and why "how do you evaluate retrieval quality" is a real, hard question — not an afterthought.

---

## Part 2: Interview Questions

### A. Product & Problem Framing (why does this exist)

1. **What problem does this app solve that Notion/bookmarks doesn't?**
   *Tests: can you articulate value beyond "I used AI."* Core point: it's not storage, it's *retrieval and connection* — the problem is knowledge decay (you forget what you saved and how it relates to new things you learn).

2. **Who is the target user?**
   Core point: not "everyone" — developers/students/researchers who consume high volumes of technical content. Naming a broad user signals you haven't thought about the product.

3. **How is this different from a basic note-taking app?**
   Core point: basic notes = static storage. This system actively processes (embeds), retrieves by meaning, and resurfaces connections without you asking.

4. **Why is "memory resurfacing" the differentiator and not just RAG search?**
   Core point: RAG search is reactive (user has to ask). Resurfacing is proactive — system notices new content relates to old content and surfaces it unprompted. That's the harder, more interesting engineering problem.

5. **If you had to cut the project down to 3 features for an MVP, what would you keep and why?**
   Core point: save → embed → semantic search. Everything else (graph, resurfacing, agent) is Phase 2+. Shows you can prioritize.

6. **How would you validate that people actually want this before building all of it?**
   Core point: build the thinnest save+search loop first, use it yourself for 2 weeks, see if you actually return to old saves. Dogfooding > guessing.

### B. Async Architecture (Redis/BullMQ)

7. **Why not just process the PDF/URL synchronously inside the API request?**
   Core point: blocking the HTTP request for 10-20s ties up a server thread/connection per request, doesn't scale under concurrent load, and risks timeouts.

8. **Why Redis + BullMQ over just polling the database for pending jobs?**
   Core point: DB polling means every worker runs `SELECT * WHERE status='pending'` repeatedly — wasted queries, latency (poll interval delay), and DB load that scales badly with worker count. A queue pushes work to workers instantly and centralizes ordering/retry logic without hammering the DB.

9. **What happens if the worker crashes mid-job?**
   Core point: BullMQ tracks job state — a crashed/stalled job gets detected (via lock timeout) and re-queued for retry. This is *why* you use a queue system instead of a bare `setTimeout`/cron — you get this for free.

10. **How do you prevent the same job from processing twice (idempotency)?**
    Core point: use a unique job ID (e.g., itemId) so BullMQ deduplicates; also design the worker's DB write to be idempotent (upsert, not blind insert) so even a duplicate execution doesn't corrupt data.

11. **What's a dead-letter queue and why would you need one?**
    Core point: after N failed retries, move the job to a separate "failed" queue instead of retrying forever — lets you inspect/debug failures without blocking the main queue.

12. **Redis is in-memory — what happens if it restarts? Do you lose jobs?**
    Core point: Redis persistence (AOF/RDB) can be configured to survive restarts; without it, in-flight jobs are lost — this is a real tradeoff you should be able to name, not something to gloss over.

13. **How would you scale this if 10,000 users save items simultaneously?**
    Core point: horizontally scale workers (multiple worker processes/instances consuming the same queue), and BullMQ's concurrency setting controls how many jobs one worker handles in parallel.

14. **Why is job processing decoupled into a separate process/service instead of running inside Express?**
    Core point: separation of concerns — if the API process crashes or redeploys, in-progress heavy jobs shouldn't die with it; also lets you scale API and worker independently based on their different load patterns.

### C. Database Design (Postgres/pgvector/Prisma)

15. **Why Postgres over MongoDB for this project?**
    Core point: your data (Users, Items, Tags, Collections, Relationships) is relational — foreign keys enforce integrity (an Item must belong to a real User), and joins across these entities are cleaner in SQL than in MongoDB's document model.

16. **Why pgvector over a dedicated vector DB like Pinecone?**
    Core point: at MVP scale, one database for everything is simpler ops (no second system to manage, back up, or keep in sync); you migrate to a dedicated vector DB only once you hit real scale/performance limits pgvector can't handle.

17. **What's the tradeoff of using pgvector at scale?**
    Core point: pgvector's ANN indexes (IVFFlat/HNSW) don't scale as efficiently as purpose-built vector DBs at tens of millions of vectors — know the ceiling exists, even if you won't hit it in a portfolio project.

18. **How do you enforce that a user can only see their own items?**
    Core point: every query includes `WHERE userId = req.user.id` — enforced at the query layer, not just hidden in the UI. Say explicitly: "never trust the frontend to hide data, the backend must enforce ownership on every read/write."

19. **What's an ORM actually doing for you, and what's the cost of using one?**
    Core point: Prisma generates type-safe queries and migrations so you don't hand-write SQL/manage schema drift manually; cost is an abstraction layer — for very complex queries you sometimes need raw SQL anyway (Prisma supports this escape hatch).

20. **How would you design the schema for Item ↔ Tag ↔ Collection relationships?**
    Core point: many-to-many needs join tables (`ItemTag`, `ItemCollection`) — be ready to sketch this on a whiteboard.

21. **What happens if two chunks/embeddings for the same item get created twice due to a retry?**
    Core point: delete-then-insert or upsert-by-unique-constraint (e.g., unique on `itemId + chunkIndex`) to avoid duplicate embeddings polluting search results.

22. **How do you handle a schema migration on a live database with existing data?**
    Core point: additive migrations first (new nullable columns), backfill data, then tighten constraints — never a single destructive migration on production data.

### D. Auth & Security

23. **Why JWT over server-side sessions?**
    Core point: JWT is stateless — no DB/Redis lookup needed to validate a request, which scales horizontally without shared session storage. Tradeoff: harder to instantly revoke a JWT before it expires (sessions can be deleted immediately).

24. **Why two tokens (access + refresh) instead of one long-lived token?**
    Core point: short-lived access token limits the damage window if it's stolen (XSS, leaked logs); refresh token is long-lived but stored in httpOnly cookie, inaccessible to JS, and can be revoked server-side.

25. **Why store the refresh token in an httpOnly cookie instead of localStorage?**
    Core point: localStorage is readable by any JS running on the page — an XSS vulnerability lets an attacker steal it directly. httpOnly cookies are invisible to JavaScript entirely.

26. **What's the actual attack that rate limiting on `/login` prevents?**
    Core point: brute-force credential guessing — without a limit, a script can try thousands of passwords per second against one account.

27. **Why bcrypt instead of storing a plain SHA-256 hash?**
    Core point: SHA-256 is fast — that's bad for passwords, because fast hashing lets attackers brute-force at billions of attempts/sec on a GPU. bcrypt is deliberately slow and salts automatically, making brute-forcing computationally expensive.

28. **What happens if someone tries to log in with Google using an email that already has a password account?**
    Core point: don't silently auto-link — require the user to confirm/verify ownership first, otherwise an attacker could hijack an account by just OAuth-ing with a known email.

29. **How do you invalidate all sessions if a user's account is compromised?**
    Core point: since JWTs are stateless, you need a server-side revocation mechanism — e.g., store a `tokenVersion` on the user record, bump it on "logout everywhere," and reject tokens issued before the bump.

30. **What's CSRF and does this architecture need protection against it?**
    Core point: since you use cookies for the refresh token, CSRF is a real concern — mitigated with `SameSite=Strict/Lax` cookie attribute and/or CSRF tokens on state-changing requests.

### E. AI/RAG Pipeline

31. **Walk me through what happens end-to-end when a user asks a question.**
    Core point: query → embed query → pgvector similarity search → top-k chunks → inject into LLM prompt as context → LLM answers grounded in that context. Be able to say this without notes.

32. **Why chunk text before embedding instead of embedding the whole document?**
    Core point: token limits + retrieval precision (see Part 1). A whole-document embedding also "averages out" meaning, losing the ability to pinpoint the relevant paragraph.

33. **How do you decide chunk size?**
    Core point: tradeoff — too small loses context (a sentence alone might be ambiguous), too large dilutes relevance and wastes tokens. ~500-800 tokens with slight overlap between chunks is a common starting heuristic.

34. **What is chunk overlap and why use it?**
    Core point: without overlap, a sentence that spans a chunk boundary gets split and loses meaning; overlapping the chunk edges by ~10-20% preserves continuity.

35. **How do you measure whether your retrieval is actually good?**
    Core point: this is the hardest real question — you'd build a small eval set (query → expected relevant chunk) and measure recall@k; without this, you're flying blind on retrieval quality. Admitting "I'd need to build an eval loop, I haven't yet" is a stronger answer than pretending it's solved.

36. **What if the retrieved chunks don't actually answer the question?**
    Core point: the LLM should say "I don't have enough information in your notes" rather than hallucinate — enforced via the system prompt instruction, and ideally a confidence/similarity-score threshold before even calling the LLM.

37. **How do you prevent the LLM from making up information not in the context?**
    Core point: explicit system prompt constraint ("only use the provided context, say you don't know otherwise") — reduces but doesn't eliminate hallucination; it's a known open problem, don't overclaim you've "solved" it.

38. **Why use an external embedding API instead of a local/open-source model?**
    Core point: at MVP scale, external API (OpenAI) means zero infra to manage and consistent quality; self-hosted (Ollama) saves cost at scale but adds GPU/ops burden — explicitly a stage-appropriate tradeoff.

39. **What is the relationship engine actually doing under the hood?**
    Core point: after saving new content, compute its embedding's similarity to existing chunks; above a similarity threshold, create an edge in a relationships table (`sourceId, targetId, relationType`) — not "AI magic," just cosine similarity + a threshold.

40. **How would you control LLM API cost as usage grows?**
    Core point: limit context size (top-k), cache repeated queries, use cheaper embedding models for retrieval and only call the expensive LLM for the final answer generation.

41. **What's the difference between "search" and "RAG" in your app?**
    Core point: search returns raw matching chunks for the user to read; RAG takes those chunks and has an LLM synthesize a direct answer from them. Different UX, same retrieval backbone.

42. **What makes something "agentic" vs. just an API call to an LLM?**
    Core point: agentic = the LLM decides which tool to call next based on context (e.g., "should I search, should I create a relationship, should I summarize") rather than a fixed, hardcoded sequence — be honest if your version is closer to a fixed pipeline than a true agent.

### F. Scalability & Failure Handling

43. **What happens when you have 100,000 chunks — does semantic search stay fast?**
    Core point: naive nearest-neighbor search is O(n); pgvector's HNSW/IVFFlat index avoids scanning every row, trading a small accuracy loss for large speed gains — name the index, don't just say "it's fast."

44. **What's your strategy if the embedding API is down?**
    Core point: the save should still succeed (status stays "processing" or a new "embedding_failed" state), with retry via the queue — don't let an external dependency's downtime break the core save flow.

45. **How do you handle duplicate saves of the same URL?**
    Core point: check for an existing item with the same URL+userId before creating a new one (or dedupe at ingestion) — otherwise storage and search results get polluted with duplicates.

46. **What's your caching strategy, if any?**
    Core point: even without Redis-as-cache (since Redis here is for the queue), you could cache frequent/expensive queries (e.g., dashboard stats) — be ready to say what you *would* cache and why, even if not yet implemented.

47. **How would this break under load, and how would you find out before users do?**
    Core point: load testing (k6/Artillery) on the save + search endpoints, watching queue depth and DB connection pool saturation — shows you think about "how do I know it's broken" not just "how do I fix it."

48. **What's a single point of failure in your current architecture?**
    Core point: honest answer — a single Postgres instance and single Redis instance are both SPOFs; production fix would be replication/managed HA services. Naming your own weaknesses is a strong signal, not a weak one.

### G. General System Design / Tradeoffs

49. **Why separate frontend (Next.js) and backend (Express) instead of doing everything in Next.js API routes?**
    Core point: independent scaling and deployment, backend isn't tied to a specific frontend framework's lifecycle, and it's a more realistic mirror of how most companies structure production systems.

50. **What would you change about this architecture if you were building it for a company, not a portfolio?**
    Core point: add observability (structured logging, tracing), proper CI/CD, staging environment, rate limiting per user not just per IP, and an eval pipeline for retrieval/RAG quality.

51. **What's the hardest bug you'd expect to hit in this project, before you've even built it?**
    Core point: race conditions in the async pipeline — e.g., user deletes an item while its embedding job is still processing. Anticipating this before it happens is a strong signal.

52. **If the interviewer says "this sounds like an LLM wrapper," how do you respond?**
    Core point: don't get defensive — point to the specific engineering: async job orchestration, idempotency, per-user data isolation, retrieval quality tradeoffs, index selection. The LLM call is one line of code; everything around it is the actual project.

53. **How is `status: processing → ready → failed` implemented and surfaced to the frontend?**
    Core point: backend is source of truth; frontend either polls `GET /items/:id` or (better, mention as a stretch) uses SSE/WebSocket push — explain why polling is simpler to start with and what its downside is (latency, wasted requests).

54. **Why TypeScript over plain JavaScript for this project?**
    Core point: catches shape mismatches (e.g., `item.status` typo, wrong field name) at compile time instead of runtime — especially valuable across an async pipeline where a bug might only surface minutes later inside a worker, far from where it was introduced.

55. **What's one thing you'd do differently if you rebuilt this project today?**
    Core point: always have a real answer here — e.g., "I'd write the retrieval eval harness before building more features, since I built the pipeline before I could measure if it actually worked." Shows reflective engineering maturity, not just "nothing, it's perfect."

---

## How to actually prepare with this list

- Don't write essays for each answer. Write **one sentence per question** in your own words, out loud, without looking at the "core point." If you stall, that's the one to revisit.
- Pick 5 questions per category and actually try to break your own design against them while building — e.g., while writing the save endpoint, ask yourself Q10 (idempotency) *before* the interviewer does.
- The questions you should fear most are 35, 48, 51, 55 — they don't have a clean answer, and how you handle "I don't fully know, here's how I'd find out" matters more than a rehearsed answer.