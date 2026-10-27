/**
 * Types for `scripts/probe-landmarks.mjs`.
 *
 * The runtime module stays plain ESM so the optional probe can run under bare
 * node without a build; this declaration lets the offline tests (which run
 * through tsx and are typechecked by tsc) consume it.
 */

export interface ProbeLandmark {
  readonly key: string;
  readonly name: string;
  readonly selector: string;
  /** `'always'`, a key of {@link PROBE_ANCHORS}, or `null` for report-only. */
  readonly when: string | null;
}

export interface ProbeFailure {
  readonly code: string;
  readonly message: string;
}

export interface ProbeVerdict {
  readonly ok: boolean;
  readonly failures: readonly ProbeFailure[];
}

export declare const PROBE_ANCHORS: Readonly<Record<string, string>>;
export declare const PROBE_LANDMARKS: readonly ProbeLandmark[];
export declare const PROBE_EXIT_PASS: 0;
export declare const PROBE_EXIT_FAIL: 1;
export declare function probeVerdict(report: unknown, options?: { readonly expect?: readonly string[] }): ProbeVerdict;
export declare function probeExitCode(report: unknown, verify?: boolean, expect?: readonly string[]): 0 | 1;
