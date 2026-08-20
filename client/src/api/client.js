import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  // The agent can take a while (retrieval + a live web search + LLM
  // synthesis) -- give it room rather than timing out a legitimate run.
  timeout: 120000,
});

/** Submit a new research query. Returns the saved ResearchReport. */
export async function submitQuery(query) {
  const { data } = await api.post('/query', { query });
  return data;
}

/**
 * Fetch paginated research history.
 * params: { page, limit, status, search, bookmarked }
 */
export async function fetchHistory(params = {}) {
  const { data } = await api.get('/history', { params });
  return data; // { items, pagination }
}

/** Fetch a single full report (including intermediate_steps). */
export async function fetchReport(id) {
  const { data } = await api.get(`/history/${id}`);
  return data;
}

/** Toggle bookmark status on a report. Returns the updated report. */
export async function toggleBookmark(id) {
  const { data } = await api.patch(`/history/${id}/bookmark`);
  return data;
}

export default api;
