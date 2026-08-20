import { Search, Star, Loader2 } from 'lucide-react';
import { VerificationPill } from './VerificationBadge';

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'UPDATED', label: 'Updated' },
  { key: 'CONTRADICTED', label: 'Contradicted' },
];

function timeAgo(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Sidebar({
  history,
  isLoading,
  activeFilter,
  onFilterChange,
  searchTerm,
  onSearchChange,
  selectedId,
  onSelect,
  onToggleBookmark,
  hasMore,
  onLoadMore,
  isLoadingMore,
}) {
  return (
    <aside className="w-80 shrink-0 border-r border-slate-200 bg-white h-full flex flex-col">
      <div className="p-4 border-b border-slate-200 space-y-3">
        <h1 className="text-lg font-bold text-slate-800">Research Assistant</h1>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search history..."
            className="w-full rounded-lg border border-slate-300 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => onFilterChange(key)}
              className={`text-xs font-medium rounded-full px-2.5 py-1 border transition-colors ${
                activeFilter === key
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scroll-thin">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 size={18} className="animate-spin" />
          </div>
        )}

        {!isLoading && history.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8 px-4">
            No research queries yet. Ask something to get started.
          </p>
        )}

        <ul className="divide-y divide-slate-100">
          {history.map((item) => (
            <li key={item._id}>
              <button
                type="button"
                onClick={() => onSelect(item._id)}
                className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
                  selectedId === item._id ? 'bg-brand-50' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800 line-clamp-2 flex-1">
                    {item.query}
                  </p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleBookmark(item._id);
                    }}
                    className="shrink-0"
                    aria-label="Toggle bookmark"
                  >
                    <Star
                      size={15}
                      className={
                        item.is_bookmarked
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-slate-300 hover:text-slate-400'
                      }
                    />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <VerificationPill status={item.verification_status} />
                  <span className="text-xs text-slate-400">{timeAgo(item.createdAt)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>

        {!isLoading && hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoadingMore}
            className="w-full text-xs font-medium text-brand-600 hover:text-brand-700 py-3 disabled:opacity-50"
          >
            {isLoadingMore ? 'Loading...' : 'Load more'}
          </button>
        )}
      </div>
    </aside>
  );
}
