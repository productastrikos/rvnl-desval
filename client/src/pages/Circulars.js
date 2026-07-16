import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, Field, Spinner, Pill, FeedbackBar, ModuleChat } from '../components/feature/FeatureKit';
import { listCirculars, addCircular, deleteCircular, circularDigest, logInteraction } from '../services/featureApi';

export default function Circulars() {
  const [tab, setTab] = useState('registry');

  return (
    <Page
      title="Railway Guidelines & Amendment Tracking"
      subtitle="A living registry of Railway Board, RDSO, zonal railway and CPWD circulars, guidelines and correction slips. Every upload is auto-summarised, its supersession/amendment links are tracked, and its text grounds the assistant — so project teams always work with the most recent requirements."
      actions={
        <div className="flex gap-1.5">
          <button onClick={() => setTab('registry')} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${tab === 'registry' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>Registry</button>
          <button onClick={() => setTab('digest')} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${tab === 'digest' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>Latest Requirements</button>
        </div>
      }
    >
      {tab === 'registry' ? <Registry /> : <Digest />}

      <ModuleChat
        module="circulars"
        title="Ask about guidelines & circulars"
        placeholder="e.g. What changed in the latest correction slip to the concrete bridge code?"
        suggestions={[
          'Summarise the latest guidance on Gati Shakti project sanction procedures.',
          'Which circulars in the registry are superseded and by what?',
          'What are the current requirements for design & drawing approval of ROBs?',
        ]}
      />
    </Page>
  );
}

/* ── Registry tab ────────────────────────────────────────────────────────── */
function Registry() {
  const [data, setData]   = useState(null);
  const [q, setQ]         = useState('');
  const [cat, setCat]     = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);      // uploading
  const [loading, setLoading] = useState(false);  // listing
  const [open, setOpen]   = useState({});         // expanded cards
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await listCirculars({ q, category: cat })); setError(null); }
    catch (e) { setError(e.message); }
    setLoading(false);
  }, [q, cat]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  const onUpload = async (files) => {
    setBusy(true); setError(null);
    let failed = 0;
    for (const file of files) {
      try { await addCircular({ file }); } catch (e) { failed++; setError(e.message); }
    }
    setBusy(false);
    if (failed < files.length) load();
  };

  const onDelete = async (c) => {
    if (!window.confirm(`Remove "${c.refNo || c.name}" from the registry?`)) return;
    try { await deleteCircular(c.id); load(); } catch (e) { setError(e.message); }
  };

  const categories = data?.categories || [];
  const circulars  = data?.circulars || [];
  const superseded = circulars.filter(c => c.supersededBy).length;

  const tableRows = circulars.map((c, i) => ({
    'Sl.No': i + 1, 'Ref No': c.refNo || '', 'Authority': c.authority || '', 'Date': c.issueDate || '',
    'Subject': c.subject || c.name, 'Category': c.category, 'Supersedes': (c.supersedes || []).join('; '),
    'Amends': (c.amends || []).join('; '), 'Status': c.supersededBy ? `Superseded by ${c.supersededBy}` : 'In force',
  }));

  return (
    <>
      <Card title="Add circulars / guidelines" desc="Upload one or many files — each is read (with OCR for scans), auto-summarised, and its reference number, issue date and supersession/amendment links are extracted into the registry.">
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.png,.jpg,.jpeg,.tiff,.txt" className="hidden"
          onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) onUpload(fs); }} />
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors disabled:opacity-40">
          {busy ? <><Spinner /> Reading, summarising & indexing…</> : (
            <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            Upload circular(s) — Railway Board · RDSO · zonal · CPWD (PDF / scan / DOCX)</>
          )}
        </button>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Tracked" value={data?.total ?? '—'} tone="sky" />
        <StatTile label="Matching Filter" value={data?.count ?? '—'} tone="violet" />
        <StatTile label="In Force" value={data ? (data.count - superseded) : '—'} tone="emerald" />
        <StatTile label="Superseded" value={data ? superseded : '—'} tone="amber" />
      </div>

      <Card title="Registry" right={
        <div className="flex items-center gap-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search ref no, subject, keyword…"
            className="text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200 w-56" />
          <select value={cat} onChange={e => setCat(e.target.value)}
            className="text-[11px] px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-200">
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      }>
        {loading && <div className="text-[11px] text-slate-500 flex items-center gap-1.5"><Spinner /> Loading…</div>}
        {!loading && !circulars.length && (
          <div className="text-[11px] text-slate-500 text-center py-6">No circulars tracked yet{q || cat ? ' for this filter' : ''}. Upload the guidelines your contracts work to — the registry keeps them summarised and amendment-tracked.</div>
        )}
        <div className="space-y-2">
          {circulars.map(c => (
            <div key={c.id} className={`rounded-lg border p-3 text-[11px] ${c.supersededBy ? 'border-amber-500/30 bg-amber-500/[0.04]' : 'border-app-border bg-slate-950/30'}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono font-bold text-sky-300">{c.refNo || '(no ref)'}</span>
                    {c.authority && <span className="text-slate-400">· {c.authority}</span>}
                    {c.issueDate && <span className="text-slate-500">· {c.issueDate}</span>}
                    <Pill value={c.category}>{c.category}</Pill>
                    {c.supersededBy
                      ? <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase bg-amber-500/15 text-amber-300 border-amber-500/30">⚠ Superseded by {c.supersededBy}</span>
                      : <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase bg-emerald-500/15 text-emerald-300 border-emerald-500/30">In force</span>}
                  </div>
                  <div className="text-slate-200 font-semibold">{c.subject || c.name}</div>
                  {c.summary && <div className="text-slate-400 leading-snug">{c.summary}</div>}
                  {(c.supersedes?.length > 0 || c.amends?.length > 0) && (
                    <div className="text-[10px] text-slate-500">
                      {c.supersedes?.length > 0 && <span>Supersedes: <span className="text-slate-300">{c.supersedes.join('; ')}</span></span>}
                      {c.supersedes?.length > 0 && c.amends?.length > 0 && ' · '}
                      {c.amends?.length > 0 && <span>Amends: <span className="text-slate-300">{c.amends.join('; ')}</span></span>}
                    </div>
                  )}
                  {open[c.id] && c.keyChanges?.length > 0 && (
                    <div className="pt-1 space-y-0.5">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Key changes</div>
                      {c.keyChanges.map((k, i) => <div key={i} className="text-slate-300 pl-3">· {k}</div>)}
                      {c.applicability && <div className="text-[10px] text-slate-500 pt-1">Applies to: {c.applicability}</div>}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <button onClick={() => setOpen(s => ({ ...s, [c.id]: !s[c.id] }))} className="text-[10px] text-sky-300 hover:text-sky-200">
                    {open[c.id] ? '− Less' : '+ Key changes'}
                  </button>
                  <button onClick={() => onDelete(c)} className="text-slate-600 hover:text-red-400" title="Delete">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
        {tableRows.length > 0 && (
          <ResultTable columns={['Sl.No', 'Ref No', 'Authority', 'Date', 'Subject', 'Category', 'Supersedes', 'Amends', 'Status']}
            rows={tableRows} title="Circulars Register" sheetName="Circulars" downloadName="RVNL_Circulars_Register" />
        )}
      </Card>
    </>
  );
}

/* ── Latest-requirements digest tab ──────────────────────────────────────── */
function Digest() {
  const [topic, setTopic] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes]     = useState(null);

  const run = async () => {
    if (!topic.trim()) { setError('Enter the topic to brief on.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      const r = await circularDigest({ topic });
      setRes(r);
      logInteraction({ module: 'Guidelines & Circulars', prompt: topic, subject: 'Latest-requirements digest',
        response: (r.summary || '').slice(0, 400) }).catch(() => {});
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <>
      <Card title="What currently applies?" desc="Ask for the current governing requirements on any topic — the assistant assembles them from the tracked circulars (marking superseded ones) and the indexed standards, with the amendment trail.">
        <Field label="Topic" value={topic} onChange={setTopic}
          placeholder="e.g. USFD testing of rails · OHE implantation near platforms · EPC variation approvals · cess width standards" />
        <RunButton onClick={run} busy={busy} busyLabel="Assembling the current requirements…">Get Latest Requirements</RunButton>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {res && (
        <Card title={`Current requirements · ${res.topic}`} desc={res.summary}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <StatTile label="Registry Matches" value={res.registryMatches} tone="sky" />
            <StatTile label="Requirements" value={res.currentRequirements?.length || 0} tone="emerald" />
            <StatTile label="Amendment Steps" value={res.amendmentTrail?.length || 0} tone="violet" />
          </div>

          {res.currentRequirements?.length > 0 && (
            <ResultTable
              columns={['Requirement', 'Reference', 'Since']}
              rows={res.currentRequirements.map(r => ({ 'Requirement': r.requirement || '', 'Reference': r.reference || '', 'Since': r.since || '' }))}
              title="Currently applicable requirements" sheetName="Requirements"
              downloadName={`Requirements_${res.topic.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}`} />
          )}

          {res.amendmentTrail?.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-300">Amendment trail (newest first)</div>
              {res.amendmentTrail.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${/superseded/i.test(a.status) ? 'bg-amber-400' : /amended/i.test(a.status) ? 'bg-violet-400' : 'bg-emerald-400'}`} />
                  <div>
                    <span className="font-mono font-semibold text-slate-200">{a.reference}</span>
                    {a.date && <span className="text-slate-500"> · {a.date}</span>}
                    {a.status && <span className={`ml-1.5 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${/superseded/i.test(a.status) ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'}`}>{a.status}</span>}
                    {a.note && <div className="text-slate-400">{a.note}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {res.watchouts?.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-bold text-slate-300">Watch-outs</div>
              {res.watchouts.map((w, i) => <div key={i} className="text-[11px] text-amber-300 flex gap-2"><span>⚠</span><span className="text-slate-300">{w}</span></div>)}
            </div>
          )}

          {res.actions?.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] font-bold text-slate-300">Suggested actions</div>
              {res.actions.map((a, i) => <div key={i} className="text-[11px] text-emerald-200 flex gap-2"><span>✓</span><span>{a}</span></div>)}
            </div>
          )}

          {res.citations?.length > 0 && <div className="text-[10px] text-slate-500">Grounded in: {res.citations.join(' · ')}</div>}
          <FeedbackBar module="circulars" subject={`Digest · ${res.topic.slice(0, 60)}`} />
        </Card>
      )}
    </>
  );
}
