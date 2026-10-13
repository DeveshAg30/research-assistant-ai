import {
  CheckCircle2,
  RefreshCcw,
  AlertTriangle,
  HelpCircle,
  Database,
  XCircle,
  Ban,
  Loader2,
  RotateCcw,
  Info,
} from 'lucide-react';
import { messageFor } from '../errorMessages';

const STATUS_CONFIG = {
  CONFIRMED: {
    label: 'Confirmed',
    icon: CheckCircle2,
    badge: 'bg-green-100 text-green-800 border-green-300',
    banner: 'bg-green-50 border-green-300 text-green-900',
    bar: 'bg-green-500',
    description: 'The internal database and a live web check agree.',
  },
  UPDATED: {
    label: 'Updated',
    icon: RefreshCcw,
    badge: 'bg-blue-100 text-blue-800 border-blue-300',
    banner: 'bg-blue-50 border-blue-300 text-blue-900',
    bar: 'bg-blue-500',
    description: 'Live web search added newer information not in the internal database.',
  },
  CONTRADICTED: {
    label: 'Contradicted',
    icon: AlertTriangle,
    badge: 'bg-red-100 text-red-800 border-red-300',
    banner: 'bg-red-50 border-red-300 text-red-900',
    bar: 'bg-red-500',
    description: 'A live web source directly conflicts with the internal database.',
  },
  INSUFFICIENT: {
    label: 'Insufficient Data',
    icon: HelpCircle,
    badge: 'bg-slate-100 text-slate-700 border-slate-300',
    banner: 'bg-slate-50 border-slate-300 text-slate-800',
    bar: 'bg-slate-400',
    description: 'Neither the internal database nor web search found relevant results.',
  },
  INTERNAL_ONLY: {
    label: 'Internal Only',
    icon: Database,
    badge: 'bg-purple-100 text-purple-800 border-purple-300',
    banner: 'bg-purple-50 border-purple-300 text-purple-900',
    bar: 'bg-purple-500',
    description: 'The internal database alone was current and sufficient.',
  },
};

// Run states that are not a verification verdict.
const RUN_CONFIG = {
  running: {
    label: 'Researching',
    icon: Loader2,
    spin: true,
    badge: 'bg-amber-50 text-amber-800 border-amber-300',
    banner: 'bg-amber-50 border-amber-300 text-amber-900',
    description: 'The agent is still working on this question.',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    badge: 'bg-red-50 text-red-700 border-red-200',
    banner: 'bg-red-50 border-red-300 text-red-900',
    description: 'This research run did not complete.',
  },
  cancelled: {
    label: 'Cancelled',
    icon: Ban,
    badge: 'bg-slate-50 text-slate-500 border-slate-200',
    banner: 'bg-slate-50 border-slate-300 text-slate-700',
    description: 'This research run was cancelled before it finished.',
  },
};

export function resolveConfig(status, runStatus) {
  if (runStatus && runStatus !== 'completed') return RUN_CONFIG[runStatus] || RUN_CONFIG.failed;
  return STATUS_CONFIG[status] || STATUS_CONFIG.INSUFFICIENT;
}

/**
 * Small pill badge -- used in the sidebar history list and per claim.
 */
export function VerificationPill({ status, runStatus }) {
  const { label, icon: Icon, badge, spin } = resolveConfig(status, runStatus);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge}`}
    >
      <Icon size={12} className={spin ? 'animate-spin' : ''} />
      {label}
    </span>
  );
}

export function ConfidenceMeter({ value, barClass = 'bg-brand-500', breakdown }) {
  if (typeof value !== 'number') return null;
  const pct = Math.round(value * 100);
  const title = breakdown
    ? Object.entries(breakdown)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
        .join('\n')
    : undefined;
  return (
    <div className="flex items-center gap-2 text-xs" title={title}>
      <span className="font-medium opacity-80">Confidence</span>
      <div
        className="h-1.5 w-28 rounded-full bg-black/10 overflow-hidden"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Confidence"
      >
        <div className={`h-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums font-semibold">{pct}%</span>
    </div>
  );
}

/**
 * Full-width banner at the top of a research answer: verdict (or run
 * state), programmatic confidence, any status adjustments, per-claim
 * verdicts, and a Retry button for failed/cancelled runs.
 */
export default function VerificationBadge({ report, onRetry }) {
  const runStatus = report.status || 'completed';
  const config = resolveConfig(report.verification_status, runStatus);
  const { label, icon: Icon, banner, description, bar, spin } = config;
  const isDone = runStatus === 'completed';
  const adjusted =
    isDone && report.self_reported_status && report.self_reported_status !== report.verification_status;
  const claims = report.claims || [];

  return (
    <div className={`rounded-lg border px-4 py-3 space-y-2 ${banner}`}>
      <div className="flex items-start gap-3">
        <Icon size={22} className={`mt-0.5 shrink-0 ${spin ? 'animate-spin' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{label}</p>
            {isDone && <ConfidenceMeter value={report.confidence} barClass={bar} breakdown={report.confidence_breakdown} />}
          </div>
          <p className="text-sm opacity-90">
            {runStatus === 'failed' || runStatus === 'cancelled'
              ? messageFor(report.error_code, null)
              : description}
          </p>
          {runStatus === 'failed' && report.error_message && (
            <p className="text-xs opacity-70 mt-1 break-words">Details: {report.error_message}</p>
          )}
        </div>
        {(runStatus === 'failed' || runStatus === 'cancelled') && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 inline-flex items-center gap-1 rounded-md bg-white/70 border border-current/20 px-2.5 py-1 text-xs font-medium hover:bg-white"
          >
            <RotateCcw size={13} /> Retry
          </button>
        )}
      </div>

      {(adjusted || report.status_flags?.length > 0) && (
        <div className="flex items-start gap-2 text-xs bg-white/50 rounded px-2 py-1.5">
          <Info size={13} className="mt-0.5 shrink-0" />
          <div>
            {adjusted && (
              <p className="font-medium">
                Status adjusted from {report.self_reported_status} after checking the evidence.
              </p>
            )}
            <ul className="list-disc ml-4">
              {report.status_flags?.map((flag) => (
                <li key={flag}>{flag}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {isDone && claims.length > 1 && (
        <ul className="space-y-1 pt-1 border-t border-current/10">
          {claims.map((claim, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate" title={claim.text}>
                {i + 1}. {claim.text}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {typeof claim.confidence === 'number' && (
                  <span className="text-xs tabular-nums opacity-70">{Math.round(claim.confidence * 100)}%</span>
                )}
                <VerificationPill status={claim.status} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
