import { useState } from 'react';
import { Database, Globe, ExternalLink } from 'lucide-react';

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

function CitationTag({ id }) {
  return id ? <span className="text-[10px] font-mono text-slate-400">[{id}]</span> : null;
}

function InternalSourceCard({ source }) {
  return (
    <a
      id={source.id ? `source-${source.id}` : undefined}
      href={source.url || undefined}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border border-slate-200 p-3 hover:border-brand-400 hover:shadow-sm transition-all bg-white scroll-mt-4 target:ring-2 target:ring-brand-400"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-0.5 truncate">
          {source.organisation || 'Unknown organisation'}
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
          {formatDate(source.date_published)}
          <CitationTag id={source.id} />
        </span>
      </div>
      <p className="text-sm font-medium text-slate-800 line-clamp-2">{source.title || source.claim}</p>
      {source.claim && source.title && (
        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{source.claim}</p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600 min-w-0 truncate">
          Verdict: <span className="font-normal">{source.original_verdict || 'N/A'}</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {typeof source.score === 'number' && (
            <span className="text-[11px] text-slate-400" title="Relevance score from the reranker">
              {Math.round(source.score * 100)}% match
            </span>
          )}
          {source.url && <ExternalLink size={13} className="text-slate-400" />}
        </span>
      </div>
    </a>
  );
}

function WebSourceCard({ source }) {
  return (
    <a
      id={source.id ? `source-${source.id}` : undefined}
      href={source.url || undefined}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border border-slate-200 p-3 hover:border-brand-400 hover:shadow-sm transition-all bg-white scroll-mt-4 target:ring-2 target:ring-brand-400"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 truncate">
          {source.domain || 'web'}
        </span>
        <span className="flex items-center gap-2 text-xs text-slate-400 shrink-0">
          {formatDate(source.published)}
          <CitationTag id={source.id} />
          {source.url && <ExternalLink size={13} />}
        </span>
      </div>
      <p className="text-sm font-medium text-slate-800 line-clamp-2">{source.title || source.url}</p>
      {source.snippet && (
        <p className="text-xs text-slate-500 mt-1 line-clamp-3">{source.snippet}</p>
      )}
    </a>
  );
}

/** Sources the answer actually cited, or all of them if it cited none. */
export function visibleSources(sources, showAll) {
  if (showAll) return sources;
  const anyCited = sources.some((s) => s.cited);
  return anyCited ? sources.filter((s) => s.cited) : sources;
}

/**
 * Tabbed grid showing Internal Database Records vs. Live Web Sources.
 * By default only sources cited in the answer are shown; "Show all
 * retrieved" reveals everything the tools returned.
 */
export default function SourceCardGrid({ internalSources = [], webSources = [] }) {
  const [activeTab, setActiveTab] = useState('internal');
  const [showAll, setShowAll] = useState(false);

  const all = activeTab === 'internal' ? internalSources : webSources;
  const shown = visibleSources(all, showAll);
  const hasUncited = all.some((s) => !s.cited) && all.some((s) => s.cited);
  const noneCited = all.length > 0 && !all.some((s) => s.cited);

  const tabs = [
    { key: 'internal', label: 'Internal Database', icon: Database, sources: internalSources },
    { key: 'web', label: 'Live Web Sources', icon: Globe, sources: webSources },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-200 mb-3">
        <div className="flex gap-1">
          {tabs.map(({ key, label, icon: Icon, sources }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-brand-500 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={15} />
              {label}
              <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-1.5">
                {visibleSources(sources, showAll).length}
              </span>
            </button>
          ))}
        </div>
        {(hasUncited || showAll) && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500 pb-2 cursor-pointer">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all retrieved ({all.length})
          </label>
        )}
      </div>

      {noneCited && (
        <p className="text-xs text-slate-400 mb-2">
          The answer did not cite these sources directly; showing everything that was retrieved.
        </p>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-slate-400 italic py-4">
          No {activeTab === 'internal' ? 'internal database records' : 'live web sources'} were
          used for this query.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {shown.map((source, idx) =>
            activeTab === 'internal' ? (
              <InternalSourceCard key={source.id || idx} source={source} />
            ) : (
              <WebSourceCard key={source.id || idx} source={source} />
            )
          )}
        </div>
      )}
    </div>
  );
}
