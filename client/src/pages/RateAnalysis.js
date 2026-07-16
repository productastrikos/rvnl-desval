import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Card, StatTile, RunButton, ErrorNote, ResultTable, Field, Spinner, FeedbackBar, ModuleChat, RichText } from '../components/feature/FeatureKit';
import { listRateSources, addRateSource, deleteRateSource, searchRates, justifyRate, rateCheckBoq, logInteraction, downloadWord, downloadPdf } from '../services/featureApi';
import { RATE_SOURCES } from '../services/rvnlKnowledge';

const SEARCH_COLS = ['Sl.No', 'Source', 'Source Type', 'Item Ref', 'Description', 'Unit', 'Rate', 'Edition / Year', 'Remarks'];
const SEARCH_KEYS = ['slNo', 'source', 'sourceType', 'itemRef', 'description', 'unit', 'rate', 'edition', 'remarks'];

const BOQ_COLS = ['Sl.No', 'Item Ref', 'Description', 'Unit', 'Qty', 'Quoted Rate', 'SOR Rate', 'LAR Rate', 'Best Source', 'Variance', 'Remarks'];
const BOQ_KEYS = ['slNo', 'itemRef', 'description', 'unit', 'qty', 'quotedRate', 'sorRate', 'larRate', 'bestSource', 'variance', 'remarks'];

export default function RateAnalysis() {
  const [tab, setTab] = useState('search');
  const tabs = [
    ['search', 'Rate Search & Comparison'],
    ['justify', 'Justification Note'],
    ['boq', 'BOQ Rate Check'],
    ['sources', 'Rate Sources'],
  ];

  return (
    <Page
      title="Rate Analysis & Estimation Support"
      subtitle="Retrieve and compare item rates across CPWD SOR/DSR, Railway zonal SORs and Last Accepted Rates (LARs) from the IREPS portal in one search — then draft the cost-justification note. Upload your rate schedules once under Rate Sources; every search scans all of them side-by-side."
      actions={
        <div className="flex gap-1.5 flex-wrap">
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${tab === k ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-800 text-slate-400 border-slate-700'}`}>{l}</button>
          ))}
        </div>
      }
    >
      {tab === 'search' && <RateSearch />}
      {tab === 'justify' && <Justify />}
      {tab === 'boq' && <BoqCheck />}
      {tab === 'sources' && <Sources />}

      <ModuleChat
        module="rates"
        title="Ask the Rates Assistant"
        placeholder="e.g. Which source should take precedence — LAR or SOR — for a works estimate?"
        suggestions={[
          'When should LAR (IREPS) rates be preferred over SOR rates in an estimate?',
          'How do I apply cost indices to bring a 2021 SOR rate to current price level?',
          'What should a rate-reasonableness justification for a non-schedule item contain?',
        ]}
      />
    </Page>
  );
}

/* ── Tab 1 · Cross-source rate search ────────────────────────────────────── */
function RateSearch() {
  const [query, setQuery] = useState('');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes]     = useState(null);

  const run = async () => {
    if (!query.trim()) { setError('Enter the item / work description to search for.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      const r = await searchRates({ query });
      setRes(r);
      logInteraction({ module: 'Rate Analysis', prompt: query, subject: 'Rate search',
        response: `${r.rowCount || 0} rate entries found across ${r.sourcesConsidered?.length || 0} sources.` }).catch(() => {});
      if (!r.rows?.length) setError(r.summary || 'No matching schedule entries found. Try the SOR item wording or different keywords.');
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const rows = (res?.rows || []).map(o => { const r = {}; SEARCH_KEYS.forEach((k, i) => { r[SEARCH_COLS[i]] = o[k] ?? ''; }); return r; });
  const cmp = res?.comparison || {};

  return (
    <>
      <Card title="1 · Item to price" desc="Describe the work item the way the schedule would word it — the search scans every uploaded CPWD SOR, Railway SOR and IREPS LAR document.">
        <Field label="Item / work description" value={query} onChange={setQuery} textarea rows={2}
          placeholder="e.g. Providing and laying M35 PQC pavement · Earthwork in embankment with contractor's own soil · 25 kV OHE mast erection" />
        <RunButton onClick={run} busy={busy} busyLabel="Searching all rate sources…">Search & Compare Rates</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Scanning each source's schedule text and matching items…</div>}
      </Card>

      {res?.rows?.length > 0 && (
        <>
          <Card title="2 · Rates found across sources" desc="One row per matching schedule item per source. Copy for Excel or export.">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
              <StatTile label="Entries" value={res.rowCount} tone="sky" />
              <StatTile label="Sources Scanned" value={res.sourcesConsidered?.length || 0} tone="violet" />
              <StatTile label="Lowest" value={cmp.lowest ? cmp.lowest.split('—')[0].trim() : '—'} tone="emerald" />
              <StatTile label="Spread" value={cmp.spreadPct || '—'} tone="amber" />
            </div>
            <ResultTable columns={SEARCH_COLS} rows={rows} title={`Rates · ${res.query}`} sheetName="Rate Comparison"
              downloadName={`Rates_${res.query.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}`}
              note="Rates are quoted exactly as printed in each source — verify unit, lead/lift conditions and price level before adoption." />
          </Card>

          {(cmp.recommendation || cmp.justification) && (
            <Card title="3 · Recommendation & draft justification">
              {cmp.lowest && <div className="text-[11px] text-slate-300"><span className="text-slate-500 font-semibold">Lowest:</span> {cmp.lowest}{cmp.highest ? <> · <span className="text-slate-500 font-semibold">Highest:</span> {cmp.highest}</> : null}</div>}
              {cmp.recommendation && (
                <div className="bg-emerald-500/[0.05] border border-emerald-500/20 rounded-lg p-3 text-[11px] text-emerald-200">✓ {cmp.recommendation}</div>
              )}
              {cmp.justification && <RichText text={cmp.justification} />}
              <FeedbackBar module="rates" subject={`Rate search · ${res.query.slice(0, 60)}`} />
            </Card>
          )}
        </>
      )}
    </>
  );
}

/* ── Tab 2 · Rate justification note ─────────────────────────────────────── */
function Justify() {
  const [f, setF] = useState({ item: '', unit: '', qty: '', selectedRate: '', selectedSource: '', context: '' });
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes]     = useState(null);
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));

  const run = async () => {
    if (!f.item.trim()) { setError('Enter the item / work description.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      const r = await justifyRate(f);
      setRes(r);
      logInteraction({ module: 'Rate Analysis', prompt: f.item, subject: 'Rate justification note',
        response: (r.note || '').slice(0, 400) }).catch(() => {});
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const exportDoc = (kind) => {
    const payload = { title: res.title, subtitle: `Basis: ${res.basis || '—'} · Adopted rate: ${res.adoptedRate || '—'}`, text: res.note, filename: `Rate_Justification_${f.item.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}` };
    return (kind === 'word' ? downloadWord(payload) : downloadPdf(payload)).catch(e => setError(e.message));
  };

  return (
    <>
      <Card title="Draft a rate-justification note" desc="States the rates available in each uploaded source, compares them and records the reasoning for the adopted rate — ready for the estimate file.">
        <Field label="Item / work description" value={f.item} onChange={set('item')} textarea rows={2}
          placeholder="e.g. Supplying and fixing 60 kg 1080 HH CMS crossing 1 in 12" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Unit (optional)" value={f.unit} onChange={set('unit')} placeholder="cum / MT / each" />
          <Field label="Quantity (optional)" value={f.qty} onChange={set('qty')} />
          <Field label="Proposed rate (optional)" value={f.selectedRate} onChange={set('selectedRate')} placeholder="₹ …" />
          <Field label="Proposed basis (optional)" value={f.selectedSource} onChange={set('selectedSource')} placeholder="e.g. LAR NR 2025" />
        </div>
        <Field label="Additional context (optional)" value={f.context} onChange={set('context')} textarea rows={2}
          placeholder="leads/lifts, site conditions, escalation notes, why a non-schedule rate is needed…" />
        <RunButton onClick={run} busy={busy} busyLabel="Comparing sources & drafting note…">Draft Justification Note</RunButton>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      {res && (
        <Card title={res.title}
          right={
            <div className="flex gap-2">
              <button onClick={() => exportDoc('word')} className="px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 border border-sky-500/30 text-[11px] font-semibold hover:bg-sky-500/25">Word</button>
              <button onClick={() => exportDoc('pdf')} className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 border border-red-500/30 text-[11px] font-semibold hover:bg-red-500/25">PDF</button>
            </div>
          }>
          {(res.adoptedRate || res.basis) && (
            <div className="grid md:grid-cols-2 gap-3">
              {res.adoptedRate && <StatTile label="Adopted Rate" value={res.adoptedRate} tone="emerald" />}
              {res.basis && <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3 text-[11px] text-slate-300 flex items-center">{res.basis}</div>}
            </div>
          )}
          {res.comparisonRows?.length > 0 && (
            <ResultTable
              columns={['Source', 'Item Ref', 'Unit', 'Rate', 'Remarks']}
              rows={res.comparisonRows.map(r => ({ 'Source': r.source || '', 'Item Ref': r.itemRef || '', 'Unit': r.unit || '', 'Rate': r.rate || '', 'Remarks': r.remarks || '' }))}
              title="Source comparison" sheetName="Rate Comparison" downloadName="Rate_Justification_Comparison" />
          )}
          <RichText text={res.note} />
          <FeedbackBar module="rates" subject={`Justification · ${f.item.slice(0, 60)}`} />
        </Card>
      )}
    </>
  );
}

/* ── Tab 3 · BOQ rate check ──────────────────────────────────────────────── */
function BoqCheck() {
  const [file, setFile]   = useState(null);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState(null);
  const [res, setRes]     = useState(null);
  const fileRef = useRef(null);

  const run = async () => {
    if (!file) { setError('Upload a BOQ / estimate file first.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      const r = await rateCheckBoq(file);
      setRes(r);
      logInteraction({ module: 'Rate Analysis', prompt: `BOQ rate check: ${file.name}`, subject: file.name,
        response: `${r.itemCount || 0} items checked against the rate sources.` }).catch(() => {});
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const rows = (res?.rows || []).map(o => { const r = {}; BOQ_KEYS.forEach((k, i) => { r[BOQ_COLS[i]] = o[k] ?? ''; }); return r; });

  return (
    <>
      <Card title="Check a BOQ / estimate against the rate sources" desc="Upload a bill of quantities or estimate — every line item is extracted and its quoted rate is compared with the best matching SOR and LAR rates, flagging variances for cost justification.">
        <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.docx,.png,.jpg,.jpeg,.txt" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setFile(f); setRes(null); setError(null); } }} />
        <button onClick={() => fileRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          {file ? file.name : 'Upload BOQ / estimate (PDF · Excel · CSV · scan)'}
        </button>
        <RunButton onClick={run} busy={busy} busyLabel="Extracting items & checking rates…">Run BOQ Rate Check</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Large BOQs can take a minute — items are matched source-by-source.</div>}
      </Card>

      {res?.rows?.length > 0 && (
        <Card title={`Item-wise rate check · ${res.file}`}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-2">
            <StatTile label="Items" value={res.itemCount} tone="sky" />
            <StatTile label="With SOR Match" value={res.rows.filter(r => r.sorRate).length} tone="violet" />
            <StatTile label="With LAR Match" value={res.rows.filter(r => r.larRate).length} tone="emerald" />
          </div>
          {!res.sourcesAvailable && <ErrorNote>No rate sources uploaded yet — add your SOR/LAR documents under the Rate Sources tab to enable rate matching.</ErrorNote>}
          <ResultTable columns={BOQ_COLS} rows={rows} title="BOQ Rate Check" sheetName="BOQ Rate Check"
            downloadName={`BOQ_Rate_Check_${(res.file || 'boq').replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}`} />
          <FeedbackBar module="rates" subject={`BOQ check · ${res.file}`} />
        </Card>
      )}
    </>
  );
}

/* ── Tab 4 · Rate source library ─────────────────────────────────────────── */
function Sources() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy]   = useState(false);
  const [f, setF] = useState({ name: '', sourceType: RATE_SOURCES[0], edition: '', note: '' });
  const [file, setFile] = useState(null);
  const fileRef = useRef(null);
  const set = (k) => (v) => setF(s => ({ ...s, [k]: v }));

  const load = useCallback(async () => {
    try { setData(await listRateSources()); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const upload = async () => {
    if (!file) { setError('Choose the rate document file first.'); return; }
    setBusy(true); setError(null);
    try {
      await addRateSource({ file, ...f });
      setFile(null); setF({ name: '', sourceType: RATE_SOURCES[0], edition: '', note: '' });
      await load();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  const onDelete = async (s) => {
    if (!window.confirm(`Remove rate source "${s.name}"? Searches will no longer include it.`)) return;
    try { await deleteRateSource(s.id); await load(); } catch (e) { setError(e.message); }
  };

  const types = data?.sourceTypes || RATE_SOURCES;

  return (
    <>
      <Card title="Add a rate source" desc="Upload each schedule once — a CPWD SOR/DSR volume, a Railway zonal SOR chapter, an IREPS LAR extract, a market-rate analysis. It is stored on the server, indexed into the knowledge base, and scanned by every rate search.">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-300">Rate document</label>
            <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv,.docx,.png,.jpg,.jpeg,.txt" className="hidden"
              onChange={e => { const x = e.target.files?.[0]; e.target.value = ''; if (x) setFile(x); }} />
            <button onClick={() => fileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600 hover:border-sky-500/50 text-[11px] text-slate-400 hover:text-sky-300 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              {file ? file.name : 'PDF · Excel · CSV · scan'}
            </button>
            <div>
              <label className="text-[11px] font-semibold text-slate-300">Source type</label>
              <select value={f.sourceType} onChange={e => set('sourceType')(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-slate-200">
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-2">
            <Field label="Display name (optional)" value={f.name} onChange={set('name')} placeholder="e.g. CPWD DSR 2024 Vol-1 (Civil)" />
            <Field label="Edition / year / LAR date (optional)" value={f.edition} onChange={set('edition')} placeholder="e.g. 2024 · w.e.f. 01-04-2025" />
            <Field label="Note (optional)" value={f.note} onChange={set('note')} placeholder="chapters covered, price level…" />
          </div>
        </div>
        <RunButton onClick={upload} busy={busy} busyLabel="Reading & indexing schedule…">Add Rate Source</RunButton>
        <ErrorNote>{error}</ErrorNote>
      </Card>

      <Card title={`Rate source library${data ? ` · ${data.sources.length}` : ''}`} right={
        <button onClick={load} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700">Refresh</button>
      }>
        {!data?.sources?.length ? (
          <div className="text-[11px] text-slate-500 text-center py-6">No rate sources yet. Upload your CPWD SOR, Railway SORs and IREPS LAR extracts above — searches compare every source side-by-side.</div>
        ) : (
          <div className="overflow-auto rounded-lg border border-app-border">
            <table className="w-full text-[11px] border-collapse">
              <thead className="text-[9px] uppercase tracking-widest text-slate-500 bg-white/[0.03]">
                <tr>
                  {['Source', 'Type', 'Edition', 'Pages', 'Uploaded By', 'Added', ''].map(h => <th key={h} className="text-left px-3 py-2 font-semibold border-b border-app-border whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {data.sources.map(s => (
                  <tr key={s.id} className="hover:bg-white/[0.02]">
                    <td className="px-3 py-2">
                      <div className="text-slate-200 font-semibold">{s.name}</div>
                      <div className="text-[9px] text-slate-600">{s.fileName}{s.note ? ` · ${s.note}` : ''}</div>
                    </td>
                    <td className="px-3 py-2"><span className="text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase bg-sky-500/15 text-sky-300 border-sky-500/30 whitespace-nowrap">{s.sourceType}</span></td>
                    <td className="px-3 py-2 text-slate-400">{s.edition || '—'}</td>
                    <td className="px-3 py-2 text-slate-400 font-mono">{s.pages || '—'}</td>
                    <td className="px-3 py-2 text-slate-400">{s.uploadedBy}</td>
                    <td className="px-3 py-2 text-slate-500">{s.addedAt ? new Date(s.addedAt).toLocaleDateString() : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => onDelete(s)} className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10" title="Remove source">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
