/**
 * Screening decisions JSON array stability — mirrors qualification JSON wait.
 */
import {
  REQUIRED_JSON_STABLE_POLLS,
  getPostJsonUiGraceMs,
  type JsonStabilityState,
} from "../chatgptQualification/canonicalJsonCompletion.js";
import { tryParseScreeningDecisionsJson } from "./screeningDecisionSchema.js";

export function tickScreeningJsonStability(options: {
  text: string;
  textHash: string;
  previous: JsonStabilityState;
  nowMs: number;
  stopStillVisible: boolean;
  postJsonUiGraceMs?: number;
  requiredStablePolls?: number;
}): {
  state: JsonStabilityState;
  validJson: boolean;
  schemaValid: boolean;
  stable: boolean;
  shouldComplete: boolean;
  ignoreStaleStop: boolean;
  count: number;
} {
  const required = options.requiredStablePolls ?? REQUIRED_JSON_STABLE_POLLS;
  const graceMs = options.postJsonUiGraceMs ?? getPostJsonUiGraceMs();
  const parsed = tryParseScreeningDecisionsJson(options.text);
  let state: JsonStabilityState = { ...options.previous };

  if (!parsed.ok) {
    state = {
      stablePolls: 0,
      lastHash: options.textHash,
      validJsonSeen: false,
      firstValidAtMs: null,
      stableSinceMs: null,
    };
    return {
      state,
      validJson: false,
      schemaValid: false,
      stable: false,
      shouldComplete: false,
      ignoreStaleStop: false,
      count: 0,
    };
  }

  if (!state.validJsonSeen) {
    state = {
      validJsonSeen: true,
      firstValidAtMs: options.nowMs,
      stablePolls: 1,
      lastHash: options.textHash,
      stableSinceMs: null,
    };
  } else if (state.lastHash === options.textHash) {
    const nextPolls = state.stablePolls + 1;
    state = {
      ...state,
      stablePolls: nextPolls,
      lastHash: options.textHash,
      stableSinceMs:
        nextPolls >= required ? (state.stableSinceMs ?? options.nowMs) : null,
    };
  } else {
    state = {
      validJsonSeen: true,
      firstValidAtMs: options.nowMs,
      stablePolls: 1,
      lastHash: options.textHash,
      stableSinceMs: null,
    };
  }

  const stable = state.stablePolls >= required;
  const graceElapsed =
    state.stableSinceMs != null &&
    options.nowMs - state.stableSinceMs >= graceMs;
  const ignoreStaleStop = stable && options.stopStillVisible && graceElapsed;
  const shouldComplete = stable && (!options.stopStillVisible || graceElapsed);

  return {
    state,
    validJson: true,
    schemaValid: true,
    stable,
    shouldComplete,
    ignoreStaleStop,
    count: parsed.count,
  };
}
