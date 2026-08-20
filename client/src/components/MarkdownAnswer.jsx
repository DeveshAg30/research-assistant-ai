import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders the agent's final Markdown answer with sensible typography.
 * Requires the `@tailwindcss/typography` plugin (see tailwind.config.js).
 */
export default function MarkdownAnswer({ content }) {
  if (!content) {
    return <p className="text-sm text-slate-400 italic">No answer content.</p>;
  }

  return (
    <div className="prose prose-sm sm:prose-base max-w-none prose-a:text-brand-600 prose-headings:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
