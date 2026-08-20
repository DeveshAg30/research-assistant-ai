import { useState } from 'react';
import { Database, Globe, ExternalLink } from 'lucide-react';

function InternalSourceCard({ source }) {
  return (
    <a
      href={source.url || undefined}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border border-slate-200 p-3 hover:border-brand-400 hover:shadow-sm transition-all bg-white"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-purple-700 bg-purple-50 border border-purple-200 rounded px-2 py-0.5">
          {source.organisation || 'Unknown organisation'}
        </span>
        {source.date_published && (
          <span className="text-xs text-slate-400">
            {new Date(source.date_published).toLocaleDateString() || source.date_published}
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-slate-800 line-clamp-2">{source.title || source.claim}</p>
      {source.claim && source.title && (
        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{source.claim}</p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-600">
          Verdict: <span className="font-normal">{source.original_verdict || 'N/A'}</span>
        </span>
        {source.url && <ExternalLink size={13} className="text-slate-400" />}
      </div>
    </a>
  );
}

function WebSourceCard({ source }) {
  return (
    <a
      href={source.url || undefined}
      target="_blank"
      rel="noreferrer"
      className="block rounded-lg border border-slate-200 p-3 hover:border-brand-400 hover:shadow-sm transition-all bg-white"
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
          {source.domain || 'web'}
        </span>
        {source.url && <ExternalLink size={13} className="text-slate-400" />}
      </div>
      <p className="text-sm font-medium text-slate-800 line-clamp-2">{source.title || source.url}</p>
      {source.snippet && (
        <p className="text-xs text-slate-500 mt-1 line-clamp-3">{source.snippet}</p>
      )}
    </a>
  );
}

/**
 * Tabbed grid showing Internal Database Records vs. Live Web Sources.
 */
export default function SourceCardGrid({ internalSources = [], webSources = [] }) {
  const [activeTab, setActiveTab] = useState('internal');

  const tabs = [
    { key: 'internal', label: 'Internal Database', icon: Database, count: internalSources.length },
    { key: 'web', label: 'Live Web Sources', icon: Globe, count: webSources.length },
  ];

  const activeSources = activeTab === 'internal' ? internalSources : webSources;

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200 mb-3">
        {tabs.map(({ key, label, icon: Icon, count }) => (
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
            <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-1.5">{count}</span>
          </button>
        ))}
      </div>

      {activeSources.length === 0 ? (
        <p className="text-sm text-slate-400 italic py-4">
          No {activeTab === 'internal' ? 'internal database records' : 'live web sources'} were
          cited for this query.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {activeSources.map((source, idx) =>
            activeTab === 'internal' ? (
              <InternalSourceCard key={idx} source={source} />
            ) : (
              <WebSourceCard key={idx} source={source} />
            )
          )}
        </div>
      )}
    </div>
  );
}
