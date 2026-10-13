import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchMe: vi.fn(), fetchHistory: vi.fn() };
});

import App from './App';
import * as apiClient from './api/client';

describe('auth gate', () => {
  it('shows the sign-in page without a token', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs out and shows sign-in when the stored token is rejected', async () => {
    apiClient.setToken('expired');
    apiClient.fetchMe.mockRejectedValue({ response: { status: 401, data: { code: 'UNAUTHORIZED' } } });
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(apiClient.getToken()).toBeNull();
  });

  it('shows the dashboard for a valid token', async () => {
    apiClient.setToken('good');
    apiClient.fetchMe.mockResolvedValue({ user: { id: '1', email: 'a@b.co' }, usage: { queries: 3, limit: 50 } });
    apiClient.fetchHistory.mockResolvedValue({ items: [], pagination: { page: 1, totalPages: 1 } });
    render(<App />);
    expect(await screen.findByText('3 of 50')).toBeInTheDocument();
    expect(screen.getByText('a@b.co')).toBeInTheDocument();
  });
});
