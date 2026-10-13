import { Wrench, ListChecks } from 'lucide-react';
import VerificationBadge from './VerificationBadge';
import ReasoningTimeline from './ReasoningTimeline';
import SourceCardGrid from './SourceCardGrid';
import MarkdownAnswer from './MarkdownAnswer';

/**
 * One question/answer turn. Used both for saved reports and for the live,
 * streaming run (`isLive`), where `report.output` is the draft so far.
 */
export default function ReportView({ report, isLive = false, liveClaims = [], onRetry }) {
  const steps = report.intermediate_steps || [];
  const isCompleted = report.status === 'completed';

  return (
    <article className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Query</p>
        <p className="text-slate-800 font-medium break-words">{report.query}</p>
      </div>

      <VerificationBadge report={report} onRetry={onRetry} />

      {isLive && liveClaims.length > 1 && (
        <div className="text-sm text-slate-600">
          <p className="flex items-center gap-1.5 font-medium mb-1">
            <ListChecks size={15} /> Checking {liveClaims.length} separate claims:
          </p>
          <ol className="list-decimal ml-6 space-y-0.5">
            {liveClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ol>
        </div>
      )}

      {report.tools_used?.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <Wrench size={13} />
          Tools used:
          <div className="flex flex-wrap gap-1.5">
            {report.tools_used.map((t) => (
              <span key={t} className="bg-slate-100 rounded-full px-2 py-0.5 font-mono text-slate-600">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {(isLive || isCompleted || report.output) && (
        <section className="bg-white border border-slate-200 rounded-lg p-5">
          <MarkdownAnswer content={report.output} isStreaming={isLive} />
        </section>
      )}

      {isCompleted && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Sources</h2>
          <SourceCardGrid internalSources={report.internal_sources} webSources={report.web_sources} />
        </section>
      )}

      {(isLive || steps.length > 0) && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">
            {isLive ? 'Live Reasoning Steps' : 'Reasoning Steps'}
          </h2>
          <ReasoningTimeline steps={steps} isLive={isLive} />
        </section>
      )}
    </article>
  );
}
