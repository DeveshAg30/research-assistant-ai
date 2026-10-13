import { describe, expect, it } from 'vitest';
import { applyStreamEvent, liveReportView, startLiveRun } from './liveRun';

describe('live run reducer', () => {
  it('builds the timeline and answer from stream events', () => {
    let s = startLiveRun('Is 5G safe?');
    s = applyStreamEvent(s, 'report', { report: { _id: 'r1', query: 'Is 5G safe?', status: 'running' } });
    s = applyStreamEvent(s, 'claims', { claims: ['a', 'b'] });
    s = applyStreamEvent(s, 'token', { text: 'Let me check' });
    s = applyStreamEvent(s, 'tool_start', { index: 0, tool: 'internal_research_db', tool_input: { query: 'x' }, log: '' });
    expect(s.draft).toBe(''); // pre-tool chatter is discarded

    let view = liveReportView(s);
    expect(view.intermediate_steps[0].observation).toBeUndefined(); // running step
    expect(view.tools_used).toEqual(['internal_research_db']);

    s = applyStreamEvent(s, 'tool_end', { index: 0, step: { tool: 'internal_research_db', observation: 'done' } });
    s = applyStreamEvent(s, 'token', { text: 'It is ' });
    s = applyStreamEvent(s, 'token', { text: 'false.' });
    view = liveReportView(s);
    expect(view.output).toBe('It is false.');
    expect(view.intermediate_steps[0].observation).toBe('done');
    expect(view._id).toBe('r1');

    s = applyStreamEvent(s, 'final', { report: { _id: 'r1', status: 'completed' } });
    expect(s.done).toBe(true);
    expect(s.report.status).toBe('completed');
  });
});
