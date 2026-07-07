export type ReplayUrlState = {
  scenarioId: string | null;
  step: number;
};

export const REPLAY_PARAM = "replay";
export const STEP_PARAM = "step";

type ReplayStepCounts = ReadonlyMap<string, number> | Record<string, number>;

function getStepCount(stepCounts: ReplayStepCounts, scenarioId: string): number | undefined {
  if ("get" in stepCounts && typeof stepCounts.get === "function") {
    return stepCounts.get(scenarioId);
  }

  return (stepCounts as Record<string, number>)[scenarioId];
}

export function parseReplayUrlState(
  search: string | URLSearchParams,
  stepCounts: ReplayStepCounts,
): ReplayUrlState {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const scenarioId = params.get(REPLAY_PARAM);

  if (!scenarioId) {
    return { scenarioId: null, step: 0 };
  }

  const stepCount = getStepCount(stepCounts, scenarioId);

  if (!stepCount || stepCount < 1) {
    return { scenarioId: null, step: 0 };
  }

  const rawStep = Number(params.get(STEP_PARAM) ?? "0");
  const step = Number.isFinite(rawStep)
    ? Math.max(0, Math.min(Math.floor(rawStep), stepCount - 1))
    : 0;

  return { scenarioId, step };
}

export function applyReplayUrlState(url: URL, state: ReplayUrlState): URL {
  const nextUrl = new URL(url.href);

  if (state.scenarioId) {
    nextUrl.searchParams.set(REPLAY_PARAM, state.scenarioId);
    nextUrl.searchParams.set(STEP_PARAM, String(state.step));
  } else {
    nextUrl.searchParams.delete(REPLAY_PARAM);
    nextUrl.searchParams.delete(STEP_PARAM);
  }

  return nextUrl;
}
