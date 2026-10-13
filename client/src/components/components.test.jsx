import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourceCardGrid, { visibleSources } from './SourceCardGrid';
import VerificationBadge from './VerificationBadge';
import QueryInput, { MAX_QUERY_LENGTH } from './QueryInput';
import MarkdownAnswer, { linkCitations } from './MarkdownAnswer';

const internal = [
  { id: 'I-1', organisation: 'AFP', title: 'Cited one', cited: true, score: 0.9 },
  { id: 'I-2', organisation: 'AAP', title: 'Uncited one', cited: false },
];

describe('SourceCardGrid', () => {
  it('shows only cited sources until "show all" is ticked', async () => {
    render(<SourceCardGrid internalSources={internal} webSources={[]} />);
    expect(screen.getByText('Cited one')).toBeInTheDocument();
    expect(screen.queryByText('Uncited one')).not.toBeInTheDocument();
    expect(screen.getByText('90% match')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText(/show all retrieved/i));
    expect(screen.getByText('Uncited one')).toBeInTheDocument();
  });

  it('falls back to everything when nothing was cited', () => {
    const none = internal.map((s) => ({ ...s, cited: false }));
    expect(visibleSources(none, false)).toHaveLength(2);
  });
});

describe('VerificationBadge', () => {
  it('shows failed state with a friendly message and retry', async () => {
    const onRetry = vi.fn();
    render(
      <VerificationBadge
        report={{ status: 'failed', error_code: 'AI_TIMEOUT', error_message: 'took 120s' }}
        onRetry={onRetry}
      />
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText(/took too long/i)).toBeInTheDocument();
    expect(screen.queryByText('Insufficient Data')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows cancelled state', () => {
    render(<VerificationBadge report={{ status: 'cancelled', error_code: 'CANCELLED' }} />);
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows confidence, adjustment flags and per-claim verdicts', () => {
    render(
      <VerificationBadge
        report={{
          status: 'completed',
          verification_status: 'INTERNAL_ONLY',
          self_reported_status: 'CONFIRMED',
          status_flags: ['Reported CONFIRMED without any live web search results.'],
          confidence: 0.62,
          claims: [
            { text: 'Claim A', status: 'INTERNAL_ONLY', confidence: 0.6 },
            { text: 'Claim B', status: 'CONTRADICTED', confidence: 0.4 },
          ],
        }}
      />
    );
    expect(screen.getByRole('meter', { name: 'Confidence' })).toHaveAttribute('aria-valuenow', '62');
    expect(screen.getByText(/adjusted from CONFIRMED/i)).toBeInTheDocument();
    expect(screen.getByText('2. Claim B')).toBeInTheDocument();
    expect(screen.getByText('Contradicted')).toBeInTheDocument();
  });
});

describe('QueryInput', () => {
  it('blocks submitting queries over the limit', async () => {
    const onSubmit = vi.fn();
    render(<QueryInput onSubmit={onSubmit} isLoading={false} />);
    const input = screen.getByRole('textbox');
    await userEvent.click(input);
    await userEvent.paste('x'.repeat(MAX_QUERY_LENGTH + 1));
    expect(screen.getByRole('alert')).toHaveTextContent(/limited to 2,000/);
    expect(screen.getByRole('button', { name: /research/i })).toBeDisabled();
  });

  it('shows Cancel while a run is in progress', async () => {
    const onCancel = vi.fn();
    render(<QueryInput onSubmit={vi.fn()} onCancel={onCancel} isLoading />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe('MarkdownAnswer citations', () => {
  it('links citation groups but leaves normal links alone', () => {
    expect(linkCitations('False [I-1, W-ab12cd]. See [docs](https://x.y).')).toBe(
      'False [I-1](#source-I-1) [W-ab12cd](#source-W-ab12cd). See [docs](https://x.y).'
    );
  });

  it('renders citation chips', () => {
    render(<MarkdownAnswer content="AFP says false [I-7]." />);
    expect(screen.getByRole('link', { name: 'I-7' })).toHaveAttribute('href', '#source-I-7');
  });
});
