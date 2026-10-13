import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

import Sidebar from '../components/Sidebar';
import QueryInput from '../components/QueryInput';
import ReportView from '../components/ReportView';
import { fetchHistory, fetchReport, fetchSession, toggleBookmark } from '../api/client';
import { streamQuery } from '../api/stream';
import { useAuth } from '../context/AuthContext';
import { toUserError } from '../errorMessages';
import { applyStreamEvent, liveReportView, startLiveRun } from './liveRun';

const PAGE_SIZE = 15;

export default function ResearchDashboard() {
  const { user, usage, logout, refreshUsage } = useAuth();

  const [history, setHistory] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const [activeFilter, setActiveFilter] = useState('ALL');
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // The open conversation: { sessionId, reports } (null = new research).
  const [thread, setThread] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [live, setLive] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  const loadHistory = useCallback(
    async (targetPage, { append = false } = {}) => {
      append ? setIsLoadingMore(true) : setIsHistoryLoading(true);
      setHistoryError('');
      try {
        const { items, pagination } = await fetchHistory({
          page: targetPage,
          limit: PAGE_SIZE,
          status: activeFilter,
          search: searchTerm || undefined,
          bookmarked: bookmarkedOnly ? 'true' : undefined,
        });
        setHistory((prev) => (append ? [...prev, ...items] : items));
        setTotalPages(pagination.totalPages);
        setPage(pagination.page);
      } catch (err) {
        setHistoryError(`Couldn't load your history. ${toUserError(err).message}`);
      } finally {
        append ? setIsLoadingMore(false) : setIsHistoryLoading(false);
      }
    },
    [activeFilter, searchTerm, bookmarkedOnly]
  );

  // Reload from page 1 whenever the filter or search term changes.
  useEffect(() => {
    const debounce = setTimeout(() => loadHistory(1), searchTerm ? 350 : 0);
    return () => clearTimeout(debounce);
  }, [loadHistory, searchTerm]);

  // Abort an in-flight run if the dashboard unmounts (e.g. sign out).
  useEffect(() => () => abortRef.current?.abort(), []);

  const upsertHistoryItem = (report) =>
    setHistory((prev) =>
      prev.some((h) => h._id === report._id)
        ? prev.map((h) => (h._id === report._id ? report : h))
        : [report, ...prev]
    );

  const appendToThread = (report) =>
    setThread((prev) => ({
      sessionId: report.session,
      reports: [...(prev?.sessionId === report.session ? prev.reports : []), report],
    }));

  const runQuery = async (query, sessionId) => {
    setErrorMessage('');
    const controller = new AbortController();
    abortRef.current = controller;
    let state = startLiveRun(query);
    setLive(state);
    if (!sessionId) setThread(null);

    const onEvent = (event, data) => {
      state = applyStreamEvent(state, event, data);
      setLive(state);
      if (event === 'report') {
        setSelectedId(data.report._id);
        upsertHistoryItem(data.report);
      } else if (event === 'final' || event === 'error') {
        appendToThread(data.report);
        upsertHistoryItem(data.report);
      }
    };

    try {
      await streamQuery({ query, sessionId, signal: controller.signal, onEvent });
    } catch (err) {
      const { code, message } = toUserError(err);
      if (state.report._id && !state.done) {
        // The stream broke after the report existed (cancel, timeout, network).
        const ended = { ...liveReportView(state), status: code === 'CANCELLED' ? 'cancelled' : 'failed', error_code: code };
        appendToThread(ended);
        upsertHistoryItem(ended);
      } else if (code !== 'CANCELLED') {
        setErrorMessage(message);
      }
    } finally {
      abortRef.current = null;
      setLive(null);
      refreshUsage();
    }
  };

  const handleSubmitQuery = (query) => runQuery(query, thread?.sessionId || null);
  const handleCancel = () => abortRef.current?.abort();
  const handleRetry = (report) => runQuery(report.query, report.session || null);

  const handleNewResearch = () => {
    if (live) return;
    setThread(null);
    setSelectedId(null);
    setErrorMessage('');
  };

  const handleSelectHistoryItem = async (id) => {
    if (live) return;
    setErrorMessage('');
    try {
      const report = await fetchReport(id);
      if (report.session) {
        const { reports } = await fetchSession(report.session);
        setThread({ sessionId: report.session, reports });
      } else {
        setThread({ sessionId: null, reports: [report] });
      }
      setSelectedId(id);
      requestAnimationFrame(() =>
        document.getElementById(`report-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      );
    } catch (err) {
      setErrorMessage(toUserError(err).message);
    }
  };

  const handleToggleBookmark = async (id) => {
    try {
      const updated = await toggleBookmark(id);
      setHistory((prev) => prev.map((h) => (h._id === id ? { ...h, is_bookmarked: updated.is_bookmarked } : h)));
      setThread((prev) =>
        prev && { ...prev, reports: prev.reports.map((r) => (r._id === id ? updated : r)) }
      );
    } catch (err) {
      setErrorMessage(toUserError(err).message);
    }
  };

  // Keep the live run in view as it grows.
  useEffect(() => {
    if (live) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [live?.steps.length, live?.report._id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reports = thread?.reports || [];
  const isEmpty = !live && reports.length === 0;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        history={history}
        isLoading={isHistoryLoading}
        loadError={historyError}
        isLoadingMore={isLoadingMore}
        hasMore={page < totalPages}
        onLoadMore={() => loadHistory(page + 1, { append: true })}
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        bookmarkedOnly={bookmarkedOnly}
        onBookmarkedOnlyChange={setBookmarkedOnly}
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        selectedId={selectedId}
        onSelect={handleSelectHistoryItem}
        onToggleBookmark={handleToggleBookmark}
        onNewResearch={handleNewResearch}
        user={user}
        usage={usage}
        onLogout={logout}
      />

      <main className="flex-1 overflow-y-auto scroll-thin bg-slate-50">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {isEmpty && (
            <div className="flex flex-col items-center justify-center text-center py-16 text-slate-400">
              <Sparkles size={32} className="mb-3" />
              <p className="font-medium">Ask a factual question to get started</p>
              <p className="text-sm">
                Answers are checked against the internal fact-check database first, then verified
                live on the web if needed. Ask follow-ups to dig deeper.
              </p>
            </div>
          )}

          {reports.map((report, i) => (
            <div key={report._id || i} id={`report-${report._id}`} className="scroll-mt-4">
              {i > 0 && <hr className="mb-6 border-slate-200" />}
              <ReportView report={report} onRetry={live ? undefined : () => handleRetry(report)} />
            </div>
          ))}

          {live && (
            <div key="live">
              {reports.length > 0 && <hr className="mb-6 border-slate-200" />}
              <ReportView report={liveReportView(live)} isLive liveClaims={live.claims} />
            </div>
          )}

          {errorMessage && (
            <div className="rounded-lg border border-red-300 bg-red-50 text-red-800 text-sm px-4 py-3" role="alert">
              {errorMessage}
            </div>
          )}

          <div className="sticky bottom-0 bg-slate-50 pt-2 pb-4" ref={bottomRef}>
            <QueryInput
              onSubmit={handleSubmitQuery}
              onCancel={handleCancel}
              isLoading={Boolean(live)}
              isFollowUp={Boolean(thread?.sessionId)}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
