import { useState } from 'react';
import { ChevronDown, Database, Globe, BookOpen, Wrench } from 'lucide-react';

const TOOL_META = {
  internal_research_db: { label: 'Internal Database', icon: Database, color: 'text-purple-600' },
  web_search: { label: 'Web Search', icon: Globe, color: 'text-blue-600' },
  wikipedia: { label: 'Wikipedia', icon: BookOpen, color: 'text-amber-600' },
};

function toolMeta(toolName) {
  return TOOL_META[toolName] || { label: toolName, icon: Wrench, color: 'text-slate-600' };
}

function stepInputSummary(toolInput) {
  if (typeof toolInput === 'string') return toolInput;
  if (toolInput && typeof toolInput === 'object') {
    return toolInput.query ?? JSON.stringify(toolInput);
  }
  return String(toolInput ?? '');
}

function AccordionItem({ step, index, isOpen, onToggle }) {
  const { label, icon: Icon, color } = toolMeta(step.tool);

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-800">
          <span className="text-xs text-slate-400 font-mono">#{index + 1}</span>
          <Icon size={16} className={color} />
          <span className={color}>{label}</span>
          <span className="text-slate-400 font-normal truncate max-w-xs">
            "{stepInputSummary(step.tool_input)}"
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`text-slate-400 transition-transform shrink-0 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="px-3 py-3 text-sm space-y-2 bg-white">
          {step.log && (
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
                Agent reasoning
              </p>
              <p className="whitespace-pre-wrap text-slate-700">{step.log}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">
              Tool result
            </p>
            <pre className="whitespace-pre-wrap break-words text-xs bg-slate-50 border border-slate-100 rounded p-2 max-h-64 overflow-auto text-slate-600 scroll-thin">
              {step.observation}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Displays the agent's decision-making flow (tool calls, thoughts, and raw
 * tool output) as a collapsible accordion / timeline.
 */
export default function ReasoningTimeline({ steps = [] }) {
  const [openIndex, setOpenIndex] = useState(steps.length > 0 ? 0 : null);

  if (!steps.length) {
    return (
      <p className="text-sm text-slate-400 italic">
        No reasoning steps recorded for this query.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <AccordionItem
          key={index}
          step={step}
          index={index}
          isOpen={openIndex === index}
          onToggle={() => setOpenIndex(openIndex === index ? null : index)}
        />
      ))}
    </div>
  );
}
