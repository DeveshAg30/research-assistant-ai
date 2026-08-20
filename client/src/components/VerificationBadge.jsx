import { CheckCircle2, RefreshCcw, AlertTriangle, HelpCircle, Database } from 'lucide-react';

const STATUS_CONFIG = {
  CONFIRMED: {
    label: 'Confirmed',
    icon: CheckCircle2,
    badge: 'bg-green-100 text-green-800 border-green-300',
    banner: 'bg-green-50 border-green-300 text-green-900',
    description: 'The internal database and a live web check agree.',
  },
  UPDATED: {
    label: 'Updated',
    icon: RefreshCcw,
    badge: 'bg-blue-100 text-blue-800 border-blue-300',
    banner: 'bg-blue-50 border-blue-300 text-blue-900',
    description: 'Live web search added newer information not in the internal database.',
  },
  CONTRADICTED: {
    label: 'Contradicted',
    icon: AlertTriangle,
    badge: 'bg-red-100 text-red-800 border-red-300',
    banner: 'bg-red-50 border-red-300 text-red-900',
    description: 'A live web source directly conflicts with the internal database.',
  },
  INSUFFICIENT: {
    label: 'Insufficient Data',
    icon: HelpCircle,
    badge: 'bg-slate-100 text-slate-700 border-slate-300',
    banner: 'bg-slate-50 border-slate-300 text-slate-800',
    description: 'Neither the internal database nor web search found relevant results.',
  },
  INTERNAL_ONLY: {
    label: 'Internal Only',
    icon: Database,
    badge: 'bg-purple-100 text-purple-800 border-purple-300',
    banner: 'bg-purple-50 border-purple-300 text-purple-900',
    description: 'The internal database alone was current and sufficient.',
  },
};

function resolveConfig(status) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.INSUFFICIENT;
}

/**
 * Small pill badge -- used in the sidebar history list.
 */
export function VerificationPill({ status }) {
  const { label, icon: Icon, badge } = resolveConfig(status);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${badge}`}
    >
      <Icon size={12} />
      {label}
    </span>
  );
}

/**
 * Full-width banner -- used at the top of the research answer.
 */
export default function VerificationBadge({ status }) {
  const { label, icon: Icon, banner, description } = resolveConfig(status);
  return (
    <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${banner}`}>
      <Icon size={22} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">{label}</p>
        <p className="text-sm opacity-90">{description}</p>
      </div>
    </div>
  );
}
