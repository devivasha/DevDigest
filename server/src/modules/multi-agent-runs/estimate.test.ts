import { describe, expect, it } from 'vitest';
import type { MultiAgentEstimateAgent } from '@devdigest/shared';
import { summariseEstimate } from './estimate.js';

function agent(over: Partial<MultiAgentEstimateAgent> = {}): MultiAgentEstimateAgent {
  return {
    agent_id: 'agent-default',
    est_duration_ms: 1000,
    est_cost_usd: 0.01,
    ...over,
  };
}

describe('summariseEstimate', () => {
  it('sums per-agent costs and takes the MAX per-agent duration (fan-out wall-clock)', () => {
    const perAgent: MultiAgentEstimateAgent[] = [
      agent({ agent_id: 'a1', est_duration_ms: 4_000, est_cost_usd: 0.02 }),
      agent({ agent_id: 'a2', est_duration_ms: 9_000, est_cost_usd: 0.05 }),
      agent({ agent_id: 'a3', est_duration_ms: 2_000, est_cost_usd: 0.01 }),
    ];

    const summary = summariseEstimate(perAgent);

    expect(summary.est_duration_ms).toBe(9_000); // max, not sum
    expect(summary.est_cost_usd).toBeCloseTo(0.08); // sum
    expect(summary.agent_count).toBe(3);
  });

  it('excludes cold-start (null) agents from the duration/cost summary (AC-7/AC-8)', () => {
    const perAgent: MultiAgentEstimateAgent[] = [
      agent({ agent_id: 'a1', est_duration_ms: 4_000, est_cost_usd: 0.02 }),
      agent({ agent_id: 'a2-cold-start', est_duration_ms: null, est_cost_usd: null }),
      agent({ agent_id: 'a3', est_duration_ms: 6_000, est_cost_usd: 0.03 }),
    ];

    const summary = summariseEstimate(perAgent);

    expect(summary.est_duration_ms).toBe(6_000);
    expect(summary.est_cost_usd).toBeCloseTo(0.05);
    // Cold-start agent still counts toward the total agent count -- it is
    // "no estimate yet", not "not part of this launch".
    expect(summary.agent_count).toBe(3);
  });

  it('returns null (not 0/NaN) when every agent is cold-start, and never crashes on empty input', () => {
    const allColdStart: MultiAgentEstimateAgent[] = [
      agent({ agent_id: 'a1', est_duration_ms: null, est_cost_usd: null }),
      agent({ agent_id: 'a2', est_duration_ms: null, est_cost_usd: null }),
    ];
    const summary = summariseEstimate(allColdStart);
    expect(summary.est_duration_ms).toBeNull();
    expect(summary.est_cost_usd).toBeNull();
    expect(summary.agent_count).toBe(2);

    const empty = summariseEstimate([]);
    expect(empty).toEqual({ est_duration_ms: null, est_cost_usd: null, agent_count: 0 });
  });

  it('is deterministic across repeated calls with the same input', () => {
    const perAgent: MultiAgentEstimateAgent[] = [
      agent({ agent_id: 'a1', est_duration_ms: 3_000, est_cost_usd: 0.04 }),
      agent({ agent_id: 'a2', est_duration_ms: null, est_cost_usd: null }),
    ];
    expect(summariseEstimate(perAgent)).toEqual(summariseEstimate(perAgent));
  });
});
