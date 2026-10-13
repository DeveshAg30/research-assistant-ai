import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const CITATION_GROUP_RE = /\[((?:[IW]-[A-Za-z0-9]+)(?:\s*[,;]\s*[IW]-[A-Za-z0-9]+)*)\](?!\()/g;

/**
 * Turns inline citations like "[I-123]" or "[I-1, W-ab12cd]" into
 * Markdown links to "#source-<id>", which are rendered as chips below.
 */
export function linkCitations(markdown) {
  return (markdown || '').replace(CITATION_GROUP_RE, (_, group) =>
    group
      .split(/\s*[,;]\s*/)
      .map((id) => `[${id}](#source-${id})`)
      .join(' ')
  );
}

function CitationChip({ id }) {
  const handleClick = (e) => {
    e.preventDefault();
    const card = document.getElementById(`source-${id}`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('ring-2', 'ring-brand-400');
      setTimeout(() => card.classList.remove('ring-2', 'ring-brand-400'), 1500);
    }
  };
  const isWeb = id.startsWith('W-');
  return (
    <a
      href={`#source-${id}`}
      onClick={handleClick}
      title={isWeb ? 'Live web source' : 'Internal fact-check'}
      className={`not-prose inline-block align-baseline mx-0.5 rounded px-1 text-[0.7em] font-mono no-underline border ${
        isWeb
          ? 'bg-blue-50 text-blue-700 border-blue-200'
          : 'bg-purple-50 text-purple-700 border-purple-200'
      }`}
    >
      {id}
    </a>
  );
}

/**
 * Renders the agent's final Markdown answer with sensible typography.
 * Requires the `@tailwindcss/typography` plugin (see tailwind.config.js).
 */
export default function MarkdownAnswer({ content, isStreaming = false }) {
  if (!content) {
    return (
      <p className="text-sm text-slate-400 italic">
        {isStreaming ? 'Waiting for the answer…' : 'No answer content.'}
      </p>
    );
  }

  return (
    <div className="prose prose-sm sm:prose-base max-w-none prose-a:text-brand-600 prose-headings:font-semibold">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) =>
            href?.startsWith('#source-') ? (
              <CitationChip id={href.slice('#source-'.length)} />
            ) : (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            ),
        }}
      >
        {linkCitations(content)}
      </ReactMarkdown>
      {isStreaming && <span className="inline-block w-2 h-4 bg-slate-400 animate-pulse align-middle" />}
    </div>
  );
}
