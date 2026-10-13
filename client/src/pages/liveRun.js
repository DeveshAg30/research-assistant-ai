/**
 * Pure state transitions for a streaming research run. The dashboard feeds
 * every server-sent event through `applyStreamEvent`; keeping it pure makes
 * the live timeline easy to test.
 *
 * Live state shape:
 *   { report, claims, steps, draft, done }
 * where `report` is the server's report document (running -> final).
 */

export function startLiveRun(query) {
  return {
    report: { _id: null, query, status: 'running' },
    claims: [],
    steps: [],
    draft: '',
    done: false,
  };
}

export function applyStreamEvent(live, event, data) {
  switch (event) {
    case 'report':
      return { ...live, report: data.report };
    case 'claims':
      return { ...live, claims: data.claims || [] };
    case 'tool_start': {
      const steps = [...live.steps];
      steps[data.index] = { tool: data.tool, tool_input: data.tool_input, log: data.log };
      // Any text streamed before a tool call was the model thinking aloud,
      // not the final answer.
      return { ...live, steps, draft: '' };
    }
    case 'tool_end': {
      const steps = [...live.steps];
      steps[data.index] = data.step;
      return { ...live, steps };
    }
    case 'token':
      return { ...live, draft: live.draft + (data.text || '') };
    case 'final':
    case 'error':
      return { ...live, report: data.report || live.report, done: true };
    default:
      return live;
  }
}

/** What ReportView renders for a live run. */
export function liveReportView(live) {
  return {
    ...live.report,
    status: 'running',
    output: live.draft,
    intermediate_steps: live.steps.filter(Boolean),
    tools_used: [...new Set(live.steps.filter(Boolean).map((s) => s.tool))],
  };
}
