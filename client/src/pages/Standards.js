import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, Field, Spinner, Pill } from '../components/feature/FeatureKit';
import { listRuleBooks, addRuleBook, addRuleBookVersion, activateRuleBookVersion, deleteRuleBookVersion, deleteRuleBook } from '../services/featureApi';

// The authoritative library every compliance review is graded against. Only the
// ACTIVE version of each standard is indexed into the knowledge base — so when a
// correction slip is issued, uploading it as a new version is what makes the
// whole application start reviewing against the current requirement.
export default function Standards() {
  const [data, setData]     = useState(null);
  const [loading, setLoad]  = useState(false);
  const [error, setError]   = useState(null);
  const [q, setQ]           = useState('');
  const [cat, setCat]       = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoad(true);
    try { setData(await listRuleBooks()); setError(null); }
    catch (e) { setError(e.message); }
    setLoad(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const books = (data?.books || []).filter(b => {
    if (cat && b.category !== cat) return false;
    if (!q.trim()) return true;
    const hay = `${b.name} ${b.category} ${b.versions?.map(v => v.note).join(' ')}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).every(t => hay.includes(t));
  });

  const categories = data?.categories || [];
  const totalVersions = (data?.books || []).reduce((s, b) => s + (b.versionCount || 0), 0);
  const totalPages    = (data?.books || []).reduce((s, b) => {
    const active = b.versions?.find(v => v.active);
    return s + (active?.pages || 0);
  }, 0);

  return (
    <Page
      title="Standards & Codes"
      subtitle="The authoritative library every compliance review is graded against — RDSO specifications, IRS codes, the Schedule of Dimensions, IR manuals, CPWD and IS standards. Only the ACTIVE version of each document is searched, so uploading a new edition (or a correction slip) is what makes the whole application start reviewing against the current requirement. Superseded versions are kept for audit and rollback."
      actions={<button onClick={load} className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 text-[11px] font-semibold hover:bg-slate-700">Refresh</button>}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Standards" value={data?.books?.length ?? '—'} tone="sky" />
        <StatTile label="Versions Held" value={totalVersions || '—'} tone="violet" />
        <StatTile label="Active Pages" value={totalPages ? totalPages.toLocaleString() : '—'} tone="emerald" />
        <StatTile label="Categories" value={new Set((data?.books || []).map(b => b.category)).size || '—'} tone="amber" />
      </div>

      <AddStandard categories={categories} onAdded={load} />

      <Card title="Library" right={
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search standards…"
            className="text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 w-52" />
          <select value={cat} onChange={e => setCat(e.target.value)}
            className="text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      }>
        <ErrorNote>{error}</ErrorNote>
        {loading && <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><Spinner /> Loading…</div>}
        {!loading && !books.length && (
          <div className="text-[11px] text-slate-500 text-center py-6">
            {data?.books?.length ? 'No standards match this filter.' : 'No standards loaded yet. Upload the RDSO specifications, IRS codes, Schedule of Dimensions and IR manuals your contracts are reviewed against — every module cites whatever is indexed here.'}
          </div>
        )}
        <div className="space-y-2">
          {books.map(b => (
            <StandardRow key={b.id} book={b} open={openId === b.id}
              onToggle={() => setOpenId(o => o === b.id ? null : b.id)}
              onChanged={load} onError={setError} categories={categories} />
          ))}
        </div>
      </Card>
    </Page>
  );
}

/* ── Upload a new standard ───────────────────────────────────────────────── */
function AddStandard({ categories, onAdded }) {
  const [open, setOpen]   = useState(false);
  const [file, setFile]   = useState(null);
  const [f, setF]         = useState({ name: '', category: '', note: '' });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));

  useEffect(() => { if (categories.length && !f.category) setF(s => ({ ...s, category: categories[0] })); }, [categories, f.category]);

  const submit = async () => {
    if (!file) { setError('Choose the standard document file first.'); return; }
    setBusy(true); setError(null);
    try {
      await addRuleBook({ file, ...f });
      setFile(null); setF({ name: '', category: categories[0] || '', note: '' });
      setOpen(false);
      onAdded();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  if (!open) {
    return (
      <Card>
        <button onClick={() => setOpen(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add a standard / code to the library
        </button>
      </Card>
    );
  }

  return (
    <Card title="Add a standard" desc="The document is read (with OCR for scans), indexed into the knowledge base as version 1, and becomes the edition every review is graded against."
      right={<button onClick={() => setOpen(false)} className="text-[11px] text-slate-400 hover:text-white">− Cancel</button>}>
      <div className="grid md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-[11px] font-semibold text-slate-300">Document</label>
          <input ref={ref} type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.tiff" className="hidden"
            onChange={e => { const x = e.target.files?.[0]; e.target.value = ''; if (x) setFile(x); }} />
          <button onClick={() => ref.current?.click()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            {file ? file.name : 'PDF · DOCX · scan'}
          </button>
          <div>
            <label className="text-[11px] font-semibold text-slate-300">Category</label>
            <select value={f.category} onChange={e => set('category')(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200">
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Field label="Display name" value={f.name} onChange={set('name')}
            placeholder="e.g. IRS Bridge Rules - incorporating ACS up to 53" />
          <Field label="Note (edition / correction-slip level / source)" value={f.note} onChange={set('note')}
            placeholder="e.g. Source: IRICEN. Current edition in force." />
        </div>
      </div>
      <RunButton onClick={submit} busy={busy} busyLabel="Reading & indexing…">Add to Library</RunButton>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

/* ── One standard, with its version history ──────────────────────────────── */
function StandardRow({ book, open, onToggle, onChanged, onError, categories }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const active = book.versions?.find(v => v.active);

  const onNewVersion = async (file) => {
    setBusy(true);
    try {
      await addRuleBookVersion(book.id, { file, note: `New edition uploaded ${new Date().toLocaleDateString('en-IN')}` });
      onChanged();
    } catch (e) { onError(e.message); }
    setBusy(false);
  };

  const onActivate = async (v) => {
    if (!window.confirm(`Make version ${v} the active edition? Every review will be graded against it, and the current active version will be superseded (kept for audit).`)) return;
    setBusy(true);
    try { await activateRuleBookVersion(book.id, v); onChanged(); }
    catch (e) { onError(e.message); }
    setBusy(false);
  };

  const onDelVersion = async (v) => {
    if (!window.confirm(`Delete version ${v} of "${book.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try { await deleteRuleBookVersion(book.id, v); onChanged(); }
    catch (e) { onError(e.message); }
    setBusy(false);
  };

  const onDelBook = async () => {
    if (!window.confirm(`Delete "${book.name}" and ALL its versions? It will be removed from the knowledge base and reviews will no longer cite it.`)) return;
    setBusy(true);
    try { await deleteRuleBook(book.id); onChanged(); }
    catch (e) { onError(e.message); }
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-app-border bg-slate-950/30">
      <div className="flex items-start gap-3 p-3">
        <button onClick={onToggle} className="mt-0.5 shrink-0 text-slate-500 hover:text-sky-300" title="Version history">
          <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-semibold text-slate-100">{book.name}</span>
            <Pill value={book.category}>{book.category}</Pill>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
              v{book.activeVersion} active
            </span>
            {book.versionCount > 1 && <span className="text-[10px] text-slate-500">{book.versionCount} versions</span>}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {active ? `${active.pages || '—'} pages · ${Math.round((active.textLength || 0) / 1000)}k chars indexed · ` : ''}
            uploaded by {active?.uploadedBy || book.createdBy}
            {active?.note ? ` · ${active.note}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input ref={ref} type="file" accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.tiff" className="hidden"
            onChange={e => { const x = e.target.files?.[0]; e.target.value = ''; if (x) onNewVersion(x); }} />
          <button onClick={() => ref.current?.click()} disabled={busy}
            title="Upload a newer edition / correction slip — becomes the active version"
            className="px-2.5 py-1 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[10px] font-semibold hover:bg-sky-500/25 disabled:opacity-40 flex items-center gap-1">
            {busy ? <Spinner className="w-3 h-3" /> : '+'} New version
          </button>
          <button onClick={onDelBook} disabled={busy} title="Delete standard" className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-40">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
          </button>
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 pl-9 space-y-1">
          <div className="text-[9px] uppercase tracking-widest text-slate-600 font-bold">Version history</div>
          {[...(book.versions || [])].sort((a, b) => b.version - a.version).map(v => (
            <div key={v.version} className={`flex items-center gap-2 text-[11px] px-2 py-1.5 rounded ${v.active ? 'bg-emerald-500/[0.06] border border-emerald-500/25' : 'hover:bg-white/[0.02]'}`}>
              <span className="font-mono font-bold text-slate-300 w-8">v{v.version}</span>
              {v.active
                ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase bg-emerald-500/15 text-emerald-300 border-emerald-500/30">In force · searched</span>
                : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase bg-slate-600/20 text-slate-400 border-slate-600/40">Superseded</span>}
              <span className="text-slate-400 flex-1 truncate">{v.fileName} · {v.pages || '—'} pg · {v.note || 'no note'}</span>
              <span className="text-slate-600 text-[10px]">{v.uploadedAt ? new Date(v.uploadedAt).toLocaleDateString('en-IN') : ''}</span>
              {!v.active && (
                <button onClick={() => onActivate(v.version)} disabled={busy}
                  className="text-[10px] text-sky-300 hover:text-sky-200 disabled:opacity-40" title="Make this the active edition">Activate</button>
              )}
              {(book.versions || []).length > 1 && (
                <button onClick={() => onDelVersion(v.version)} disabled={busy}
                  className="text-slate-600 hover:text-red-400 disabled:opacity-40" title="Delete this version">×</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
