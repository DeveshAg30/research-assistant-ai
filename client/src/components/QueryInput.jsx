import { useState } from 'react';
import { Send, Square } from 'lucide-react';

export const MAX_QUERY_LENGTH = 2000;

const QUICK_PROMPTS = [
  'What does our database say about the climate impact on polar bears, and are there any 2025/2026 updates?',
  'Is it true that 5G towers spread disease?',
  'Did HAARP cause the recent floods in Spain?',
  'What is the latest verdict on vaccine microchip claims?',
];

export default function QueryInput({ onSubmit, onCancel, isLoading, isFollowUp = false }) {
  const [value, setValue] = useState('');
  const length = value.trim().length;
  const tooLong = length > MAX_QUERY_LENGTH;

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || isLoading || tooLong) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={MAX_QUERY_LENGTH + 200}
            placeholder={
              isFollowUp
                ? 'Ask a follow-up… e.g. "What about in 2025?"'
                : "Ask a factual question... e.g. 'Is X claim still true in 2026?'"
            }
            disabled={isLoading}
            aria-invalid={tooLong}
            aria-describedby="query-length"
            className={`w-full rounded-lg border px-4 py-2.5 pr-20 text-sm focus:outline-none focus:ring-2 focus:border-transparent disabled:bg-slate-50 ${
              tooLong ? 'border-red-400 focus:ring-red-300' : 'border-slate-300 focus:ring-brand-400'
            }`}
          />
          {length > MAX_QUERY_LENGTH * 0.8 && (
            <span
              id="query-length"
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs tabular-nums ${
                tooLong ? 'text-red-600 font-semibold' : 'text-slate-400'
              }`}
            >
              {length}/{MAX_QUERY_LENGTH}
            </span>
          )}
        </div>
        {isLoading ? (
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Square size={14} className="fill-current" />
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim() || tooLong}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
            {isFollowUp ? 'Follow up' : 'Research'}
          </button>
        )}
      </form>
      {tooLong && (
        <p className="text-xs text-red-600" role="alert">
          Questions are limited to {MAX_QUERY_LENGTH.toLocaleString()} characters. Please shorten yours by{' '}
          {(length - MAX_QUERY_LENGTH).toLocaleString()}.
        </p>
      )}

      {!isFollowUp && (
        <div className="flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={isLoading}
              onClick={() => setValue(prompt)}
              className="text-xs text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-full px-3 py-1 transition-colors disabled:opacity-50"
            >
              {prompt.length > 60 ? `${prompt.slice(0, 60)}...` : prompt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
