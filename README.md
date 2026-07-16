# RVNL Project Intelligence

An AI-driven works-intelligence platform for **Rail Vikas Nigam Limited (RVNL)**, built around
four capabilities:

1. **Rate Analysis & Estimation Support** — quick retrieval and side-by-side comparison of item
   rates from CPWD SORs/DSR, Railway zonal SORs and Last Accepted Rates (LARs) from the IREPS
   portal, plus draft cost-justification notes and BOQ rate checks.
2. **Railway Guidelines & Amendment Tracking** — a living registry of Railway Board, RDSO, zonal
   railway and CPWD circulars/guidelines. Every upload is auto-summarised, supersession/amendment
   links are tracked, and a "latest requirements" digest keeps teams on the current guidance.
3. **Drawing Compliance Verification** — consultant/DDC-submitted drawings (PDF, scans, images,
   AutoCAD .dwg/.dxf) are reviewed against the latest Indian Railways standards indexed in the
   knowledge base, with non-compliances highlighted and the governing reference cited. Includes
   drawing data extraction, revision comparison and standards-grounded review checklists.
4. **Multi-Contract Knowledge Management** — a centralized Knowledge Hub and contract-wise
   workspace (civil, S&T, electrical …) with a persistent shared repository, plus a cross-contract
   Decisions & Lessons register.

Everything runs on the local appliance. Language and vision processing are performed by an
**on-premise inference engine**; documents, queries and credentials never leave the network.

---

## 1. How it works

### On-premise inference engine
All generation and document understanding runs server-side through a single local engine
(`server/lib/llm.js`). The browser never receives credentials or raw model output beyond the
finished answer. Vision-capable requests receive page images so scanned pages, figures and
drawings can be read.

### Knowledge base
The retrieval engine is grounded in the references the teams maintain **inside the app**:

- **Standards & Codes** (`/standards`, admin, version-controlled): RDSO specifications, IRS codes,
  the Schedule of Dimensions, IR manuals (IRPWM/IRBM/ACTM), CPWD and IS/EN standards. Only the
  *active* version of each document is searched, so reviews always cite the current edition —
  uploading a new version (e.g. when a correction slip is issued) is what makes the whole
  application start reviewing against the new requirement. Superseded versions are retained for
  audit and rollback.
- **Guidelines & Circulars registry** (`/circulars`): every tracked circular's text is indexed on
  upload, with supersession/amendment links extracted automatically.
- **Rate sources** (`/rates`): every uploaded SOR/LAR schedule is indexed for retrieval and
  scanned directly by the rate-search tools.

All three persist to disk and are **re-indexed automatically at boot**.

Any PDF placed in `server/docs/` is additionally pre-ingested at boot as built-in reference
material (the directory ships empty).

> **The knowledge base is machine-local.** `server/data/{rulebooks,circulars,ratebooks}/` are
> gitignored (they hold uploaded documents, not source), so a fresh deployment starts empty and the
> standards must be uploaded once via the UI. See "First-time setup" below.

#### Retrieval: BM25 by default, semantic optional
Retrieval uses a pure-JS **BM25 keyword leg** by default — zero native dependencies, deploys
anywhere, and is well-suited to clause/standard lookups where the query terms are distinctive
(“vertical clearance”, “USFD defect classification”). Semantic embeddings are **off by default**
because `@xenova/transformers` pulls native ML binaries and spikes RAM while indexing, which
OOM-crashes memory-capped shared hosting. To enable on a host with headroom (a VPS):

```
cd server && npm install @xenova/transformers   # not a declared dependency
# then set RAG_SEMANTIC=on
```

When enabled, BM25 and semantic legs are fused with RRF and diversified with MMR. If the flag is on
but the package is absent, the engine transparently falls back to BM25 rather than failing.

### Your documents (browser-held)
Day-to-day documents are uploaded on the **Knowledge Hub** page. On upload the server:
1. extracts the text layer page-by-page, and
2. sends any page that has no usable text (scanned pages, image-only pages) to the **vision
   model** for extraction, then
3. **auto-detects the document type** (SOR / LAR / circular / drawing / estimate / tender /
   contract / report) from the content.

The extracted content is stored in the browser and stays available to every tool for the rest of
the session; ticking "Save to shared repository" persists it server-side for all users across
sessions. **Signing out clears the browser-held documents.**

---

## 2. Project layout

```
RVNL_desval/
├── server/
│   ├── index.js              # API routes, upload + auto-classification, RAG wiring
│   ├── rag/                  # Hybrid BM25 + semantic retrieval engine
│   ├── docs/                 # Optional pre-ingested reference PDFs (ships empty)
│   ├── lib/
│   │   ├── llm.js            # On-premise inference engine (text + vision)
│   │   ├── extract.js        # Per-page text + vision OCR for image-only pages
│   │   ├── rasterize.js      # PDF → page images (for the vision model)
│   │   └── excel.js          # Workbook generation
│   ├── features/
│   │   ├── rates.js          # Rate source library + SOR/LAR search, justification, BOQ check
│   │   ├── circulars.js      # Guidelines registry + amendment tracking + digest
│   │   ├── drawings.js       # Drawing compliance verification + extraction + comparison
│   │   ├── designreview.js   # Standards-grounded review checklists + risk register
│   │   ├── lessons.js        # Decisions & lessons register
│   │   ├── repository.js     # Persistent shared document repository
│   │   └── rulebooks.js      # Standards & codes library with version control (admin)
│   ├── auth/                 # JWT auth + user store
│   └── .env                  # Local engine credentials (server-side only; gitignored)
└── client/
    └── src/
        ├── pages/            # Dashboard, Railway Assistant, Rates, Circulars, Drawings, Hub…
        ├── components/       # Layout + shared feature UI kit
        └── services/
            ├── aiService.js  # Fetch calls to the backend
            ├── featureApi.js # Feature-route clients
            └── docStore.js   # Browser document store (IndexedDB)
```

---

## 3. Running it

From the project root:

```
npm run dev
```

This starts the API server (port 5001) and the client (port 3000) together. In production the
server also serves the built client from `client/build`.

### Configuration

The local engine credentials live in `server/.env` (server-side only, never sent to the browser):

```
LLM_API_KEY=...            # required
LLM_BASE_URL=...           # optional override
LLM_MODEL=...              # optional override
LLM_VISION_MODEL=...       # optional override
PORT=5001
```

Use **Settings → Test Connection** to confirm the engine is online and the knowledge base has
loaded.

### First-time setup for a project office

The knowledge base ships empty — every compliance verdict is only as good as what is loaded, so do
this before relying on any output:

1. Sign in as admin and add users (department-wise) under **User Management**.
2. Upload the standards you review against under **Standards & Codes** (`/standards`) — RDSO specs,
   IRS codes, the Schedule of Dimensions, IR manuals. Record the edition and correction-slip level
   in each name/note so reviewers can see exactly what is in force. Current consolidated editions
   are published by IRICEN at <https://iricen.gov.in/iricen/CodeManualNew.jsp>.
3. Add rate schedules under **Rate Analysis → Rate Sources** (CPWD SOR/DSR, zonal SORs, IREPS LAR
   extracts). IREPS LARs are behind portal authentication and must be exported by a user with
   access — they cannot be fetched by the app.
4. Add the circulars your contracts work to under **Guidelines & Circulars**.

**Keeping it current:** when a correction slip or new edition is issued, upload it as a **new
version** of the existing standard (Standards & Codes → *New version*) rather than a separate
entry. The new version becomes active, the old one is marked superseded but retained, and every
module immediately starts citing the new edition.

---

## 4. Roles

Two roles, authenticated with JWT (8-hour expiry):

- **Administrator** — all pages plus User Management, Audit Log and Standards & Codes.
- **Project Engineer** — all analysis pages.

Default accounts are created on first boot (`server/data/users.json`):
`admin / admin123` and `engineer1 / engineer123`.

---

## 5. Security model

- All inference runs locally on the appliance; there is no user-facing cloud configuration.
- Session documents are held only in the browser and are wiped on logout; repository documents
  persist server-side by explicit choice.
- All API routes require a bearer token except login and the health check.
- Every meaningful action is captured in the admin audit trail.
