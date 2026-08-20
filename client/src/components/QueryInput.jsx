import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';

const QUICK_PROMPTS = [
  'What does our database say about the climate impact on polar bears, and are there any 2025/2026 updates?',
  'Is it true that 5G towers spread disease?',
  'Did HAARP cause the recent floods in Spain?',
  'What is the latest verdict on vaccine microchip claims?',
];

export default function QueryInput({ onSubmit, isLoading }) {
  const [value, setValue] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || isLoading) return;
    onSubmit(trimmed);
    setValue('');
  };

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask a factual question... e.g. 'Is X claim still true in 2026?'"
          disabled={isLoading}
          className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={isLoading || !value.trim()}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {isLoading ? 'Researching...' : 'Research'}
        </button>
      </form>

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
    </div>
  );
}
