import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, Wrench } from 'lucide-react';

import Sidebar from '../components/Sidebar';
import QueryInput from '../components/QueryInput';
import VerificationBadge from '../components/VerificationBadge';
import ReasoningTimeline from '../components/ReasoningTimeline';
import SourceCardGrid from '../components/SourceCardGrid';
import MarkdownAnswer from '../components/MarkdownAnswer';
import { submitQuery, fetchHistory, fetchReport, toggleBookmark } from '../api/client';

const PAGE_SIZE = 15;

export default function ResearchDashboard() {
  const [history, setHistory] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const [selectedReport, setSelectedReport] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const loadHistory = useCallback(
    async (targetPage, { append = false } = {}) => {
      append ? setIsLoadingMore(true) : setIsHistoryLoading(true);
      try {
        const { items, pagination } = await fetchHistory({
          page: targetPage,
          limit: PAGE_SIZE,
          status: activeFilter,
          search: searchTerm || undefined,
        });
        setHistory((prev) => (append ? [...prev, ...items] : items));
        setTotalPages(pagination.totalPages);
        setPage(pagination.page);
      } catch (err) {
        console.error('Failed to load history', err);
      } finally {
        append ? setIsLoadingMore(false) : setIsHistoryLoading(false);
      }
    },
    [activeFilter, searchTerm]
  );

  // Reload from page 1 whenever the filter or search term changes.
  useEffect(() => {
    const debounce = setTimeout(() => loadHistory(1), searchTerm ? 350 : 0);
    return () => clearTimeout(debounce);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilter, searchTerm]);

  const handleSubmitQuery = async (query) => {
    setIsSubmitting(true);
    setErrorMessage('');
    try {
      const report = await submitQuery(query);
      if (report.error) {
        setErrorMessage(report.detail || report.error);
      } else {
        setSelectedReport(report);
        setHistory((prev) => [report, ...prev]);
      }
    } catch (err) {
      setErrorMessage(err.response?.data?.error || err.message || 'Something went wrong.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectHistoryItem = async (id) => {
    try {
      const report = await fetchReport(id);
      setSelectedReport(report);
    } catch (err) {
      console.error('Failed to load report', err);
    }
  };

  const handleToggleBookmark = async (id) => {
    try {
      const updated = await toggleBookmark(id);
      setHistory((prev) => prev.map((h) => (h._id === id ? updated : h)));
      setSelectedReport((prev) => (prev && prev._id === id ? updated : prev));
    } catch (err) {
      console.error('Failed to toggle bookmark', err);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        history={history}
        isLoading={isHistoryLoading}
        isLoadingMore={isLoadingMore}
        hasMore={page < totalPages}
        onLoadMore={() => loadHistory(page + 1, { append: true })}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        selectedId={selectedReport?._id}
        onSelect={handleSelectHistoryItem}
        onToggleBookmark={handleToggleBookmark}
      />

      <main className="flex-1 overflow-y-auto scroll-thin bg-slate-50">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          <QueryInput onSubmit={handleSubmitQuery} isLoading={isSubmitting} />

          {errorMessage && (
            <div className="rounded-lg border border-red-300 bg-red-50 text-red-800 text-sm px-4 py-3">
              {errorMessage}
            </div>
          )}

          {isSubmitting && (
            <div className="flex items-center gap-2 text-slate-500 text-sm py-6">
              <Loader2 size={18} className="animate-spin" />
              Researching -- checking the internal database, and the live web if needed...
            </div>
          )}

          {!isSubmitting && !selectedReport && !errorMessage && (
            <div className="flex flex-col items-center justify-center text-center py-20 text-slate-400">
              <Sparkles size={32} className="mb-3" />
              <p className="font-medium">Ask a factual question to get started</p>
              <p className="text-sm">
                Answers are checked against the internal fact-check database first, then verified
                live on the web if needed.
              </p>
            </div>
          )}

          {selectedReport && !isSubmitting && (
            <div className="space-y-6">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                  Query
                </p>
                <p className="text-slate-800 font-medium">{selectedReport.query}</p>
              </div>

              <VerificationBadge status={selectedReport.verification_status} />

              {selectedReport.tools_used?.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Wrench size={13} />
                  Tools used:
                  <div className="flex gap-1.5">
                    {selectedReport.tools_used.map((t) => (
                      <span
                        key={t}
                        className="bg-slate-100 rounded-full px-2 py-0.5 font-mono text-slate-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <section className="bg-white border border-slate-200 rounded-lg p-5">
                <MarkdownAnswer content={selectedReport.output} />
              </section>

              <section>
                <h2 className="text-sm font-semibold text-slate-700 mb-2">Sources</h2>
                <SourceCardGrid
                  internalSources={selectedReport.internal_sources}
                  webSources={selectedReport.web_sources}
                />
              </section>

              <section>
                <h2 className="text-sm font-semibold text-slate-700 mb-2">
                  Live Reasoning Steps
                </h2>
                <ReasoningTimeline steps={selectedReport.intermediate_steps || []} />
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
