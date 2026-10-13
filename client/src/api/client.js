import axios from 'axios';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
const TOKEN_KEY = 'ra_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session just won't persist */
  }
}

const api = axios.create({ baseURL: API_BASE_URL, timeout: 20000 });

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Lets AuthContext sign the user out when any call comes back 401.
let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && err.response.data?.code === 'UNAUTHORIZED') onUnauthorized();
    return Promise.reject(err);
  }
);

export async function register(email, password) {
  const { data } = await api.post('/auth/register', { email, password });
  return data; // { token, user }
}

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data;
}

export async function fetchMe() {
  const { data } = await api.get('/auth/me');
  return data; // { user, usage: { queries, limit } }
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

/** Fetch a whole conversation thread: { session, reports }. */
export async function fetchSession(id) {
  const { data } = await api.get(`/sessions/${id}`);
  return data;
}

/** Toggle bookmark status on a report. Returns the updated report. */
export async function toggleBookmark(id) {
  const { data } = await api.patch(`/history/${id}/bookmark`);
  return data;
}

export default api;
