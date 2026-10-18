# Packaged structured-clone IPC performance experiments

## Revisions and scope

Baseline: `00ab0906bad641d5be1d009da16baa5cec66a161` (main). Measured IPC snapshot: `3c9db188f077810b9cfa6b4c6e9cec52478bd26c`. The merge base equals the baseline. This measures the complete structured-clone IPC change, unlike the earlier marshalling-only microbenchmark. Correctness fixes `5817369648d7f9314c9599fc20b04fc2d88fa2ef` and `726ee9245401f48b2786a6fa78e0706fcb0c3692` are **not included** in these packages and receive separate validation.

## Local results

Negative changes mean lower cost. Latency uses medians; hardware counts use means. Intervals are paired bootstrap differences in the metric’s original units, not percentage intervals.

| Benchmark | Metric | Before | After | Change | Difference 95% CI | Valid pairs |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| startup-empty-cold-timing | startupTime | 4421.999 ms | 4429.585 ms | +0.17% | [-137.814, +91.877] ms | 37 |
| startup-empty-cold-instructions | instructions | 12.919 B | 12.843 B | -0.59% | [-0.198, +0.045] B | 37 |
| startup-empty-cold-instructions | cycles | 11.864 B | 11.519 B | -2.91% | [-0.551, -0.141] B | 37 |
| startup-empty-warm-timing | startupTime | 1628.305 ms | 1578.988 ms | -3.03% | [-86.742, +4.701] ms | 37 |
| startup-empty-warm-instructions | instructions | 6.956 B | 6.855 B | -1.45% | [-0.191, -0.017] B | 37 |
| startup-empty-warm-instructions | cycles | 5.867 B | 5.688 B | -3.05% | [-0.296, -0.058] B | 37 |
| startup-workspace-cold-timing | startupTime | 3885.236 ms | 3887.428 ms | +0.06% | [-105.685, +97.433] ms | 37 |
| startup-workspace-cold-instructions | instructions | 15.087 B | 15.274 B | +1.24% | [-0.061, +0.445] B | 35 |
| startup-workspace-cold-instructions | cycles | 13.591 B | 13.807 B | +1.59% | [-0.054, +0.493] B | 35 |
| startup-workspace-warm-timing | startupTime | 2231.619 ms | 2175.861 ms | -2.50% | [-110.155, +49.339] ms | 37 |
| startup-workspace-warm-instructions | instructions | 11.283 B | 11.216 B | -0.60% | [-0.311, +0.183] B | 37 |
| startup-workspace-warm-instructions | cycles | 10.303 B | 10.122 B | -1.76% | [-0.455, +0.100] B | 37 |
| search-timing | actionTime | 506.123 ms | 483.261 ms | -4.52% | [-72.642, +44.686] ms | 37 |
| search-instructions | instructions | 2.437 B | 2.615 B | +7.31% | [-0.116, +0.490] B | 37 |
| search-instructions | cycles | 2.774 B | 2.941 B | +6.02% | [-0.152, +0.499] B | 37 |
| settings-timing | actionTime | 2184.651 ms | 2119.641 ms | -2.98% | [-137.974, +12.055] ms | 37 |
| settings-instructions | instructions | 13.954 B | 14.376 B | +3.02% | [+0.000, +0.825] B | 25 |
| settings-instructions | cycles | 13.571 B | 14.186 B | +4.54% | [+0.063, +1.237] B | 25 |

All four local startup latency intervals cross zero. Warm empty-window startup uses 1.45% fewer instructions and 3.05% fewer cycles, but this does not establish a latency improvement. Settings uses 3.02% more instructions and 4.54% more cycles in 25 valid pairs; the instruction difference’s lower interval endpoint is only about 0.48 million instructions, so treat this as an exploratory regression signal requiring follow-up. Search instruction counts are noisy and inconclusive. Neither interaction latency interval excludes zero.

## Method and coverage

Linux x64, AMD EPYC-Rome. Twelve independent benchmark blocks, 37 alternating before/after pairs requested per block: 888 launches measured, plus unmeasured warm-up launches and excluded pilots. Local measurements reuse the exact two matched native minified cloud packages. Node 24.15.0 runs the harness; the product declares Node 24.18.0 and the build helper places that runtime first on PATH. Both products have identical Electron binary hashes.

Each launch has isolated user data, extension storage, and shared runtime directories. `--disable-extensions` disables user-installed extensions; built-in extensions remain available. Startup ends when the editor part has nonzero width; workspace startup also requires the expected text in the editor DOM. It does not wait for every background service to settle. Hardware counters measure inherited user-space work across the Electron process tree. Timing and hardware-counter collectors run separately; their durations are not interchangeable.

Cold starts clear page, dentry, and inode caches immediately before spawning. Warm starts prime the isolated profile with an unmeasured launch. Both sides receive identical treatment. The interaction cohorts require 15 seconds of stable idle before starting or after waiting for another E2E run; startup cohorts used the earlier immediate-idle guard. A one-second monitor marks detected overlapping E2E work as contamination. Ordinary host/background activity remains a source of variance.

Two cold-workspace counter samples overlapped unrelated E2E processes and were excluded, leaving 35 complete pairs. Fifteen Settings counter samples failed collection: fourteen lost monitored threads during perf attachment and one did not count cycles. Paired analysis retains 25 complete pairs for Settings. Failed samples and their original metrics are retained; there are no silent retries or outlier removals. All other cohorts have 37 valid pairs. All pilots are excluded.

The shared analysis computes 10,000 deterministic paired bootstrap resamples. Multiple metrics and scenarios are exploratory; no family-wide significance claim is made. The committed machine-readable evidence preserves all local sample metrics, statuses, diagnostics, collector coverage, paired statistics, and verified package provenance. Larger raw application/perf logs and the standalone HTML/SVG report remain in the investigation directory.

## Build validity

The initial cloud run was rejected: an old helper accepted a nonzero native gulp exit once an executable existed. Its packages and smoke results are excluded. The corrected helper rejects any nonzero gulp exit and requires a clean tracked source diff before packaging.

Both revisions require the same explicit build-only Copilot packaging adjustment: application exclusions remain intact, while built-in extension packaging retains its SDK dependencies. The original build source is restored afterward. Both complete build jobs succeeded; archive checksums, embedded source commits, all 34 desktop extension entrypoints, the codicon font, Copilot SDK/native shim, and equal Electron hashes were verified. Linux compile-cache generation is disabled by these revisions, so its absence is expected. This adjustment is recorded in package metadata.

Raw logs retain shell-environment and shutdown-channel warnings observed on both revisions. These visible-startup checks found no missing-module or extension-activation failures in the inspected smoke/pilot logs.

## Correctness follow-up

The snapshot’s recursive traversal diverged from native cloning when getters delete later properties, shrink arrays, mutate Map/Set entries, or override collection iterators. Seven regression tests fail against the snapshot. The corrected traversal checks own-property existence against the initial enumerable-key snapshot and snapshots internal Map/Set entries before recursive reads. An eighth test protects the native behavior of retaining initially enumerable properties that become non-enumerable.

The fix passes 85 Node IPC tests and 51 Electron IPC tests, including native renderer MessagePorts. Focused lint and hygiene pass. The historical full client typecheck and 19-pass/11-pending workbench smoke selection cover the earlier implementation, rather than constituting a fresh full-build result for the correction.

The separate correction microbenchmarks are complete below. The broad cloud campaign scheduled 105 benchmark blocks for the earlier snapshot and was stopped after 56 result blocks had been collected, to prioritize packaged validation of the corrected runtime. Completed and partial results are preserved; canceled blocks are not counted as measured. Hosted hardware counters are unavailable and are never reported as zeros. Fresh current-head packaged validation is separate.

## Cloud scenario failures under investigation

The first 55 collected cloud blocks include four file-opening timeouts: find-timing pair 5 before, find-renderer pair 4 before, find-resources pair 16 after, and scroll-timing pair 16 before. Their captured UI states show Quick Open with zero results despite the fixture files remaining in Explorer. They occur on both source revisions and do not establish an IPC regression; the underlying cause is unresolved. Original failed samples and logs are preserved and affected paired comparisons exclude the failed side. Failed logs also retain a main-process IPC origin rejection and unknown agent-host channel messages; no causal link to the file-opening timeout has been established. These failures must not be counted as passing correctness checks.

## Incremental correctness costs

These separate microbenchmarks use native Node 24.18 MessagePort round trips, eight randomized paired process blocks per experiment, three measured batches of 500 after 200 warm-up calls per fixture. Values are median microseconds per round trip. The 95% intervals resample paired process means 10,000 times, with percentage changes as the statistic. Seeds are 330440 for snapshot-to-mutation-fix and 330441 for mutation-fix-to-classification-fix. All 32 processes passed payload assertions and overlap checks; no process was retried or removed. Compiled module digests and all raw batch samples are preserved.

The first experiment compares `3c9db188` against `58173696`; the second compares `58173696` against the classifier adopted in `726ee924`. Do not multiply their percentage estimates into a fresh direct comparison: these are independent campaigns under different host conditions.

| Fixture | Mutation fix median change | Paired mean change 95% CI | Classification median change | Paired mean change 95% CI |
| --- | ---: | --- | ---: | --- |
| primitive | +4.05% | [-4.25%, +11.29%] | +3.50% | [-10.52%, +32.70%] |
| small-object | -10.67% | [-13.92%, +5.50%] | -9.21% | [-14.47%, +6.20%] |
| settings-100 | +7.16% | [+2.26%, +10.63%] | +2.09% | [-2.97%, +8.76%] |
| text-4KiB | +1.57% | [-17.52%, +1.09%] | +8.83% | [-3.93%, +28.38%] |
| uris-100 | +8.23% | [+0.50%, +12.91%] | +1.59% | [+0.12%, +6.12%] |
| VSBuffer-4KiB | +13.66% | [+0.49%, +18.06%] | +3.77% | [-11.03%, +15.24%] |
| cyclic-map-set | +25.52% | [+13.32%, +37.07%] | -4.38% | [-8.65%, +5.21%] |

The mutation fix has a measurable cost for settings, URIs, VSBuffer, and the small cyclic Map/Set fixture. The classifier does not show a consistent speedup and has a small additional URI cost in this campaign. It is adopted to avoid reading Symbol.toStringTag getters on ordinary and null-prototype objects: two new regressions fail at `58173696` and pass with the classifier. Current validation is 87 Node IPC tests, 53 Electron IPC tests, focused lint/hygiene, and targeted TypeScript diagnostics for the changed files. The compiled adopted IPC body matches the measured prototype, excluding its source-map URL.

These results reinforce the object-heavy tradeoff against legacy buffer IPC; the historical parent-optimization gains do not remove that limitation. Fresh packaged comparison of `726ee924` against main is separate and pending.
