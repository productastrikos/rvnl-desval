import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, StatTile, RunButton, ErrorNote, ResultTable, MultiDocSource, Field, Spinner, FeedbackBar } from '../components/feature/FeatureKit';
import { dashboardAnalytics } from '../services/featureApi';

function QuickTile({ to, icon, title, desc, accent }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(to)} className="bg-app-panel border border-app-border rounded-xl p-4 text-left hover:border-sky-500/50 transition-all group">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent}`}>{icon}</div>
        <span className="text-sm font-semibold text-white group-hover:text-sky-300 transition-colors">{title}</span>
      </div>
      <p className="text-[11px] text-slate-400 leading-snug">{desc}</p>
    </button>
  );
}

function Bar({ label, value, max, tone = 'sky' }) {
  const pct = max > 0 ? Math.round((Number(value) || 0) / max * 100) : 0;
  const color = { sky: 'bg-sky-500', amber: 'bg-amber-500', red: 'bg-red-500', emerald: 'bg-emerald-500', violet: 'bg-violet-500' }[tone] || 'bg-sky-500';
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <div className="w-44 truncate text-slate-300" title={label}>{label}</div>
      <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
      <div className="w-10 text-right text-slate-400 font-mono">{value}</div>
    </div>
  );
}

const ICN = {
  rate: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  circ: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  draw: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 9h16M9 4v16',
  hub:  'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
};

export default function Dashboard() {
  const [prompt, setPrompt]   = useState('');
  const [sources, setSources] = useState([]);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState(null);
  const [res, setRes]         = useState(null);

  const run = async () => {
    if (!prompt.trim()) { setError('Enter what you want the dashboard to analyse.'); return; }
    setBusy(true); setError(null); setRes(null);
    try {
      setRes(await dashboardAnalytics({ prompt, sources: sources.map(s => ({ name: s.name, text: s.text })) }));
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  return (
    <div className="h-full overflow-y-auto p-1 space-y-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">RVNL Project Intelligence</h1>
        <p className="text-[11px] text-slate-400 mt-0.5">Rates, guidelines, drawing compliance and multi-contract knowledge in one place — plus prompt-driven analytics over your own documents.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickTile to="/rates"     accent="bg-emerald-500/15 text-emerald-400" title="Rate Analysis" desc="Compare CPWD SOR, Railway SORs & IREPS LARs; draft rate justifications."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={ICN.rate} /></svg>} />
        <QuickTile to="/circulars" accent="bg-violet-500/15 text-violet-400" title="Guidelines & Circulars" desc="Track, summarise and amendment-chain the latest railway guidance."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={ICN.circ} /></svg>} />
        <QuickTile to="/drawings"  accent="bg-amber-500/15 text-amber-400"  title="Drawing Compliance" desc="Review consultant/DDC drawings against the latest IR standards."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={ICN.draw} /></svg>} />
        <QuickTile to="/documents" accent="bg-sky-500/15 text-sky-400"     title="Knowledge Hub"    desc="Centralised documents, decisions & compliance info across contracts."
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d={ICN.hub} /></svg>} />
      </div>

      <Card title="Prompt-Driven Analytics" desc="Select documents and ask for an item-wise breakdown, counts, comparisons or KPIs — the dashboard is built strictly from your prompt and the selected documents.">
        <div className="grid md:grid-cols-2 gap-4">
          <MultiDocSource label="Documents to analyse (optional)" values={sources} onChange={setSources} />
          <Field label="What should the dashboard show?" value={prompt} onChange={setPrompt} textarea rows={4}
            placeholder="e.g. Item-wise abstract of this BOQ by discipline · Compare quoted rates across the selected tenders · Count of pending drawing observations by system" />
        </div>
        <RunButton onClick={run} busy={busy} busyLabel="Building dashboard…">Generate Analytics</RunButton>
        <ErrorNote>{error}</ErrorNote>
        {busy && <div className="text-[10px] text-slate-500 flex items-center gap-1.5"><Spinner /> Reading the selected documents and computing analytics…</div>}
      </Card>

      {res && (
        <Card title="Analytics" desc={res.sources?.length ? `Based on: ${res.sources.join(', ')}` : 'Based on your prompt'}>
          {res.summary && <p className="text-[12px] text-slate-200 leading-relaxed">{res.summary}</p>}
          {res.kpis?.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {res.kpis.map((k, i) => <StatTile key={i} label={`${k.label}${k.unit ? ` (${k.unit})` : ''}`} value={k.value} tone={k.tone || 'sky'} />)}
            </div>
          )}
          {(res.charts || []).map((c, ci) => {
            const max = Math.max(...(c.data || []).map(d => Number(d.value) || 0), 1);
            return (
              <div key={ci} className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{c.title}</div>
                {(c.data || []).slice(0, 16).map((d, i) => <Bar key={i} label={d.label} value={d.value} max={max} tone={['sky', 'violet', 'amber', 'emerald'][ci % 4]} />)}
              </div>
            );
          })}
          {res.table?.columns?.length > 0 && (
            <ResultTable columns={res.table.columns} rows={res.table.rows || []} title="Analytics Detail" sheetName="Analytics" downloadName="Dashboard_Analytics" />
          )}
          {(!res.summary && !res.kpis?.length && !res.charts?.length && !res.table?.columns?.length) && (
            <div className="text-[11px] text-slate-500 py-4 text-center">No analytics could be derived. Try selecting documents or refining the prompt.</div>
          )}
          <FeedbackBar module="dashboard" subject={prompt.slice(0, 80)} />
        </Card>
      )}
    </div>
  );
}
