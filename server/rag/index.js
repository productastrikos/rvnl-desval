'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Full-fledged RAG Engine
// Hybrid BM25 + semantic embeddings → RRF fusion → MMR diversity
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const fs   = require('fs');

const { chunkText }                    = require('./chunker');
const { BM25 }                         = require('./bm25');
const { embedBatch, embedOne, flushCache } = require('./embedder');
const { VectorStore }                  = require('./vectorStore');
const { mmrSelect }                    = require('./mmr');

// ── In-memory stores ──────────────────────────────────────────────────────────
const docStore   = new Map();   // docId → { id, name, type, text, addedAt, chunkCount }
const chunkStore = new Map();   // chunkId → chunk meta
const bm25       = new BM25();
const vecStore   = new VectorStore();

let _kbReady = false;

// ── Railway abbreviation expander ─────────────────────────────────────────────
const RAILWAY_ABBREV = {
  rdso: 'research designs standards organisation specification guideline',
  sor: 'schedule of rates', dsr: 'delhi schedule of rates cpwd',
  ussor: 'unified standard schedule of rates works',
  lar: 'last accepted rate ireps tender', ireps: 'indian railway e-procurement last accepted rates',
  cpwd: 'central public works department schedule of rates specification',
  irs: 'indian railway standard specification code',
  sod: 'schedule of dimensions clearance moving dimension',
  irpwm: 'indian railways permanent way manual track',
  irbm: 'indian railways bridge manual', actm: 'ac traction manual ohe',
  irsem: 'indian railways signal engineering manual',
  irtmm: 'indian railways track machine manual',
  ohe: 'overhead equipment traction contact wire catenary mast implantation',
  trd: 'traction distribution overhead equipment',
  psi: 'power supply installation substation traction',
  gad: 'general arrangement drawing', rob: 'road over bridge', rub: 'road under bridge',
  lc: 'level crossing gate', fob: 'foot over bridge',
  ei: 'electronic interlocking signalling', rri: 'route relay interlocking',
  eti: 'electrical transmission installation', tss: 'traction substation',
  boq: 'bill of quantities estimate item', nit: 'notice inviting tender',
  gcc: 'general conditions of contract', scc: 'special conditions of contract',
  epc: 'engineering procurement construction contract', ddc: 'detailed design consultant drawings',
  pway: 'permanent way track sleeper rail ballast', psc: 'prestressed concrete sleeper girder',
  sej: 'switch expansion joint', lws: 'long welded rail', lwr: 'long welded rail',
  cms: 'cast manganese steel crossing', sgci: 'spheroidal graphite cast iron insert',
  ndt: 'non destructive testing examination', ut: 'ultrasonic testing',
  rt: 'radiographic testing', pt: 'penetrant testing',
  mmd: 'maximum moving dimension clearance', bg: 'broad gauge',
  cao: 'chief administrative officer construction', dfc: 'dedicated freight corridor',
  uts: 'ultimate tensile strength rail', pqc: 'pavement quality concrete',
  vcb: 'vacuum circuit breaker', acsr: 'aluminium conductor steel reinforced',
  ebxl: 'emergency crossover block signalling', tpws: 'train protection warning system',
  kavach: 'automatic train protection system atp',
};

function expandAbbreviations(q) {
  const words = q.toLowerCase().split(/\s+/);
  const extra = [];
  for (const w of words) {
    const exp = RAILWAY_ABBREV[w.replace(/[^a-z]/g, '')];
    if (exp) extra.push(exp);
  }
  return extra.length ? `${q} ${extra.join(' ')}` : q;
}

// ── Discipline query templates ────────────────────────────────────────────────
const DOMAIN_QUERIES = {
  'Civil':               'earthwork embankment cutting blanket bridge culvert retaining wall foundation concrete formwork reinforcement subgrade drainage station platform',
  'Track / P.Way':       'permanent way track rail sleeper ballast turnout points crossing welding LWR SEJ gauge alignment curve gradient schedule of dimensions',
  'Bridges / Structures': 'bridge girder span pier abutment bearing foundation ROB RUB FOB steel structure PSC composite launching load rating',
  'Signalling & Telecom': 'signalling interlocking electronic interlocking signal point machine track circuit axle counter block working cable OFC telecom control communication kavach',
  'Electrical (TRD/OHE)': 'overhead equipment OHE catenary contact wire mast implantation traction substation TSS PSI switching station neutral section bonding earthing',
  'Electrical (General)': 'electrical general services power supply lighting substation transformer panel cable distribution earthing lift escalator solar',
  'Buildings':           'station building service building platform shelter architectural finishes water supply sanitary HVAC fire fighting airport style development',
};

// ── Document ingestion ────────────────────────────────────────────────────────

/**
 * Ingest a document: chunk → embed → index in BM25 + vector store.
 * Returns the number of chunks added.
 */
async function addDocument({ id, name, type, text, uploadedBy = 'system', uploadedByRole = 'system', docCategory = 'compliance' }) {
  if (docStore.has(id)) return 0;

  // Store document metadata (cap text at 2 MB to avoid memory issues)
  docStore.set(id, {
    id, name, type,
    text: text.slice(0, 2_000_000),
    addedAt: new Date().toISOString(),
    chunkCount: 0,
    pages: Math.ceil(text.length / 3000),
    uploadedBy,
    uploadedByRole,
    docCategory,
  });

  const rawChunks = chunkText(text);
  const valid     = rawChunks.filter(c => c.wordCount >= 15);
  if (!valid.length) return 0;

  // Batch-embed all chunk texts
  let vecs;
  try {
    vecs = await embedBatch(valid.map(c => c.text));
  } catch (err) {
    console.warn(`[RAG] Embedding failed for "${name}": ${err.message} — BM25-only for this doc`);
    vecs = valid.map(() => null);
  }

  for (let i = 0; i < valid.length; i++) {
    const chunkId = `${id}~~${i}`;
    const meta    = {
      id:        chunkId,
      docId:     id,
      docName:   name,
      source:    name,
      type:      type || '',
      section:   valid[i].section || '',
      text:      valid[i].text,
      wordCount: valid[i].wordCount,
    };
    chunkStore.set(chunkId, meta);
    bm25.add(chunkId, valid[i].text);
    if (vecs[i]) {
      vecStore.add(chunkId, vecs[i], { docId: id, type: type || '', section: valid[i].section || '' });
    }
  }

  docStore.get(id).chunkCount = valid.length;
  return valid.length;
}

// ── Reciprocal Rank Fusion ────────────────────────────────────────────────────

function rrfFuse(lists, k = 60) {
  const scores = new Map();
  for (const list of lists) {
    list.forEach(({ id }, rank) => {
      scores.set(id, (scores.get(id) || 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}

// ── Retrieval ─────────────────────────────────────────────────────────────────

/**
 * Hybrid BM25 + semantic retrieval with RRF fusion and MMR diversity.
 *
 * @param {string}   query
 * @param {number}   [k=6]       Number of results
 * @param {Object}   [opts]
 * @param {string}   [opts.domain]   Domain name for query expansion
 * @param {Function} [opts.filter]   Vector store metadata filter fn
 */
async function retrieve(query, k = 6, opts = {}) {
  if (!chunkStore.size || !query?.trim()) return [];

  const { domain, filter } = opts;

  // Expand abbreviations + domain context for BM25 (keyword) leg
  const bm25Query = expandAbbreviations(
    domain ? `${query} ${DOMAIN_QUERIES[domain] || ''}` : query
  );

  // ── BM25 leg ───────────────────────────────────────────────────────────────
  const bm25Hits = bm25.search(bm25Query, k * 5);

  // ── Semantic leg ───────────────────────────────────────────────────────────
  let vecHits = [];
  try {
    const qVec = await embedOne(query);   // use original (unexpanded) for semantics
    if (qVec) vecHits = vecStore.knn(qVec, k * 5, filter || null);
  } catch { /* fall through to BM25-only */ }

  // ── RRF fusion ─────────────────────────────────────────────────────────────
  const fused = vecHits.length
    ? rrfFuse([bm25Hits, vecHits])
    : bm25Hits.map(r => ({ id: r.id, score: r.score }));

  // ── Resolve chunks with vector for MMR ────────────────────────────────────
  const candidates = fused
    .map(r => {
      const c = chunkStore.get(r.id);
      if (!c) return null;
      return { ...c, score: r.score, vec: vecStore.getVec(r.id) };
    })
    .filter(Boolean);

  // ── MMR diversity pass (λ=0.65: slight diversity preference) ──────────────
  const diverse = mmrSelect(candidates, k, 0.65);

  return diverse.map(c => ({
    source:  c.source,
    section: c.section,
    type:    c.type,
    text:    c.text,
    score:   +((c.score || 0).toFixed(4)),
    docId:   c.docId,
  }));
}

/**
 * Domain-aware retrieval using pre-built domain query templates.
 */
async function retrieveForDomain(domain, k = 8) {
  const query = DOMAIN_QUERIES[domain] || domain;
  return retrieve(query, k, { domain });
}

/**
 * Multi-query retrieval: run several queries, fuse results, apply MMR.
 * Useful for complex questions that span multiple topics.
 */
async function retrieveMulti(queries, k = 6, opts = {}) {
  if (!queries.length) return [];

  const allResults = await Promise.all(
    queries.map(q => retrieve(q, k * 2, opts))
  );

  // Flatten, dedupe by chunk id, keep highest score
  const seen   = new Map();
  const merged = [];
  for (const results of allResults) {
    for (const r of results) {
      const prev = seen.get(r.docId + r.text.slice(0, 30));
      if (!prev || r.score > prev.score) {
        seen.set(r.docId + r.text.slice(0, 30), r);
      }
    }
  }
  for (const r of seen.values()) merged.push(r);
  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, k);
}

// ── Accessors ─────────────────────────────────────────────────────────────────

function getDocText(id) {
  return docStore.get(id)?.text ?? null;
}

function getAllDocs() {
  return [...docStore.values()].map(({ id, name, type, addedAt, chunkCount, pages, uploadedBy, uploadedByRole, docCategory }) => ({
    id, name, type, addedAt, chunkCount, pages, uploadedBy, uploadedByRole, docCategory,
  }));
}

function removeDocument(docId) {
  if (!docStore.has(docId)) return false;
  const chunkIds = [...chunkStore.keys()].filter(k => k.startsWith(`${docId}~~`));
  for (const cid of chunkIds) chunkStore.delete(cid);
  bm25.remove(chunkIds);
  vecStore.remove(chunkIds);
  docStore.delete(docId);
  return true;
}

function getStatus() {
  // Intentionally omits document identities — the pre-loaded knowledge base is
  // internal to the inference engine and must not be exposed to the application.
  const userDocs = [...docStore.values()].filter(d => d.uploadedBy !== 'system');
  return {
    ready:          _kbReady,
    documents:      docStore.size,
    chunks:         chunkStore.size,
    vectorsIndexed: vecStore.size,
    bm25Indexed:    bm25.size,
    userDocuments:  userDocs.length,
  };
}

// ── Static knowledge-base initialisation ──────────────────────────────────────

// ── Static knowledge-base documents (server/docs/) ───────────────────────────
// Any PDF placed in server/docs is pre-ingested as built-in reference material
// (e.g. RDSO specifications, IRS codes, the Schedule of Dimensions, IRPWM/IRBM
// extracts, CPWD specifications). The directory ships EMPTY — the knowledge
// base is built up through the app itself: admin-managed Standards & Codes
// (version-controlled), the circulars/guidelines registry, and the rate-source
// library are all re-indexed into the KB at boot.
async function ingestDir(dir, pdfParse, defaultCategory) {
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f));
  let total = 0;
  for (const file of files) {
    const meta = {
      id:          'STATIC-' + file.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toUpperCase().replace(/\.PDF-?$/, ''),
      name:        file.replace(/\.pdf$/i, ''),
      type:        'Reference Standard',
      docCategory: defaultCategory,
    };
    if (docStore.has(meta.id)) continue;            // already indexed (dedupe across dirs)
    try {
      const buffer = fs.readFileSync(path.join(dir, file));
      const data   = await pdfParse(buffer);
      const text   = data.text || '';
      if (!text.trim()) {
        console.warn(`[RAG] No text layer in "${file}" — skipped for KB (still usable via vision in modules)`);
        continue;
      }
      const n = await addDocument({ ...meta, text, uploadedBy: 'system', uploadedByRole: 'system' });
      total += n;
      console.log(`[RAG] "${meta.name}" → ${n} chunks`);
    } catch (err) {
      console.warn(`[RAG] Skipped "${file}": ${err.message}`);
    }
  }
  return total;
}

async function initializeKnowledgeBase() {
  const pdfParse = require('pdf-parse');
  const docsDir  = path.join(__dirname, '..', 'docs');

  let total = 0;
  // Reference PDFs dropped into server/docs (if any) are pre-ingested; the rest
  // of the knowledge base (standards & codes, circulars, rate sources) is
  // re-indexed from the app's own persistent stores after this completes.
  total += await ingestDir(docsDir, pdfParse, 'compliance');

  _kbReady = true;
  flushCache();
  console.log(`[RAG] Ready — ${docStore.size} docs | ${total} chunks | ${vecStore.size} vectors | ${bm25.size} BM25 docs`);
}

module.exports = {
  addDocument,
  removeDocument,
  getDocText,
  retrieve,
  retrieveForDomain,
  retrieveMulti,
  getAllDocs,
  getStatus,
  initializeKnowledgeBase,
};
