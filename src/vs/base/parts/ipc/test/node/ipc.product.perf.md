# Packaged structured-clone IPC performance experiments

## Current measured runtime

Baseline main: `00ab0906bad641d5be1d009da16baa5cec66a161`. Corrected IPC runtime: `726ee9245401f48b2786a6fa78e0706fcb0c3692`. Subsequent documentation commits do not change the measured runtime. Earlier snapshot and marshalling-only experiments are separate.

Twelve cloud blocks and five local blocks contain 1,130 primary samples. All four initial counter pilots and the independent cold-start pilot are excluded. The results are mixed: modest cloud startup reductions and a local warm-empty CPU reduction, a Settings instruction-cost concern in a reduced valid subset, and Search assertion failures reproduced on both revisions in diagnostics, plus confirmed callback-cloning integration failures. This remains an experimental draft.

## Startup and interaction latency

Negative changes mean less time. Values are medians; intervals are paired bootstrap differences in milliseconds. Cloud and local absolute timings belong to different environments and must not be pooled.

| Environment | Workload | Main ms | IPC ms | Change | Difference 95% CI ms | Valid pairs |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| Cloud | startup-empty-cold-timing | 2620.66 | 2595.56 | -0.96% | [-46.63, -2.78] | 37 |
| Cloud | settings-timing | 1311.38 | 1252.60 | -4.48% | [-89.78, +5.91] | 37 |
| Cloud | startup-empty-warm-timing | 1071.31 | 1067.57 | -0.35% | [-12.40, +5.83] | 37 |
| Cloud | startup-workspace-cold-timing | 3054.96 | 2896.08 | -5.20% | [-633.64, +250.44] | 37 |
| Cloud | startup-workspace-warm-timing | 1559.14 | 1519.07 | -2.57% | [-59.54, -21.78] | 37 |
| Cloud | search-timing | 521.16 | 496.53 | -4.73% | [-62.21, +50.80] | 36 |
| Local | startup-workspace-cold-timing | 3862.14 | 3873.12 | +0.28% | [-43.50, +63.20] | 37 |

Cloud cold-empty and warm-workspace startup intervals exclude zero: approximately 25 ms and 40 ms reductions respectively. The other startup latency comparisons and both interaction latency comparisons are inconclusive. These are exploratory intervals across multiple metrics, without a multiple-testing guarantee.

## Local hardware counters

Counts include inherited user-space work across the Electron process tree. Values below are means in billions; intervals are differences in billions. Action windows can include background initialization and are not isolated measurements of the marshalling function.

| Workload | Metric | Main B | IPC B | Change | Difference 95% CI B | Valid pairs |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| startup-empty-warm-instructions | instructions | 6.789 | 6.728 | -0.90% | [-0.117, -0.003] | 37 |
| startup-empty-warm-instructions | cycles | 5.550 | 5.418 | -2.39% | [-0.249, -0.017] | 37 |
| startup-workspace-warm-instructions | instructions | 11.323 | 11.271 | -0.46% | [-0.380, +0.270] | 37 |
| startup-workspace-warm-instructions | cycles | 9.740 | 9.744 | +0.04% | [-0.324, +0.329] | 37 |
| search-instructions | instructions | 2.613 | 2.739 | +4.80% | [-0.242, +0.491] | 32 |
| search-instructions | cycles | 2.851 | 2.962 | +3.91% | [-0.277, +0.507] | 32 |
| settings-instructions | instructions | 13.768 | 14.643 | +6.36% | [+0.242, +1.573] | 16 |
| settings-instructions | cycles | 12.530 | 13.242 | +5.68% | [+0.081, +1.410] | 16 |

Warm empty-window startup uses 0.90% fewer instructions and 2.39% fewer cycles, with intervals excluding zero; the instruction interval only narrowly excludes zero. Warm workspace counters are inconclusive. Settings uses 6.36% more instructions and 5.68% more cycles in 16 complete pairs, a concern also seen in the earlier snapshot. Heavy collector attrition limits that conditional subset: it does not establish a general Settings regression or attribute the difference specifically to IPC. Search counters are inconclusive.

The local campaign retains 34 unavailable counter samples: 29 for Settings and 5 for Search, due to perf collection failures. They remain in the evidence; no samples were retried, replaced, or removed as outliers. Both warm-start blocks and the cold-start timing follow-up retain 37 complete pairs. Settings retains 16 and Search 32 counter pairs.

## CPU resources and physical memory

Task-clock is median aggregate process-tree CPU time in milliseconds. Peak PSS is mean proportional physical memory in MiB. Each metric uses its own complete-pair coverage; losing CPU collection does not discard a valid PSS observation.

| Workload | Metric | Main | IPC | Change | Difference 95% CI | Valid pairs |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| settings-resources | task-clock | 4763.88 ms | 4531.72 ms | -4.87% | [-499.82, +168.99] ms | 20 |
| settings-resources | peakPss | 1020.90 MiB | 1017.02 MiB | -0.38% | [-15.60, +7.77] MiB | 37 |
| startup-empty-warm-resources | task-clock | 2104.53 ms | 2082.60 ms | -1.04% | [-44.44, -3.09] ms | 37 |
| startup-empty-warm-resources | peakPss | 569.34 MiB | 566.91 MiB | -0.43% | [-8.69, +4.16] MiB | 37 |
| startup-workspace-warm-resources | task-clock | 3749.76 ms | 3690.37 ms | -1.58% | [-158.45, +32.40] ms | 37 |
| startup-workspace-warm-resources | peakPss | 758.34 MiB | 760.12 MiB | +0.23% | [-16.41, +18.71] MiB | 37 |
| search-resources | task-clock | 1036.63 ms | 1160.07 ms | +11.91% | [-43.60, +343.24] ms | 36 |
| search-resources | peakPss | 967.60 MiB | 950.70 MiB | -1.75% | [-32.13, -1.21] MiB | 36 |

Warm empty-window task-clock is about 1% lower. Search peak PSS is about 1.75% lower in 36 valid pairs; other peak-PSS intervals cross zero. These are workload/window observations, not a memory-leak assessment. Settings and Search renderer profiles use five pairs each and are diagnostic; inclusive profile sampled time must not be confused with active process CPU time.

## Cold-workspace tail follow-up

The cloud p95 point estimate increased despite the lower median, so an independent local 37-pair cold-workspace cohort was collected on the same matched packages. Both original cohorts and all samples are retained.

| Environment | Main p95 ms | IPC p95 ms | Difference ms | Exploratory paired 95% CI ms |
| --- | ---: | ---: | ---: | --- |
| cloud | 4064.90 | 5597.62 | +1532.71 | [-5019.35, +2118.62] |
| local | 3974.74 | 4064.74 | +89.99 | [-15.71, +269.59] |

Both tail intervals cross zero. The local cohort did not reproduce the cloud increase’s magnitude. With 37 observations, empirical p95 estimates and their bootstrap intervals are volatile; this establishes neither a robust tail win nor a robust tail regression. The tail statistic uses 10,000 paired resamples, XorShift32 seed 0x12345678, nearest-rank p95, and percentile indices 249/9749.

## Correctness and coverage

The cloud campaign has 9 successful and 3 partial blocks. Two Search samples on the candidate failed the visible result-summary assertion: timing pair 36 after and resources pair 12 after. Their original metrics, diagnostics, UI states, and application logs are retained. Timing uses 36 valid Search pairs. A separate 100-pair replay reuses the exact archived binaries and adds live input values and application logs to failures. All 100 baseline samples pass; 99 candidate samples pass and candidate pair 50 fails the same assertion. The query remains `small deterministic file`, so lost query text is ruled out for that failure. Copied logs contain no Search exception. Two additional passive input-trace cohorts each collect 100 pairs: cloud baseline has one failure (pair 79) and candidate passes all 100; local baseline passes all 100 and candidate has one failure (pair 85). In both traced failures, Enter reaches the focused Search textarea with the intact query. A global progress indicator subsequently activates, but the capture does not identify a backend stage. The matching successful controls show the same input event shape. Search failure is therefore observed on both revisions, and these data do not establish it as an IPC regression. Submission handling and backend completion remain unresolved; no Search fix is claimed. All 600 diagnostic replay samples and their timings remain separate from the 1,130 primary samples.

The IPC changes fix deleted properties, inherited fallbacks, array holes, Map/Set mutations and overridden iterators, plus unwanted Symbol.toStringTag getter calls on plain and null-prototype objects. Seven mutation regressions fail against the older snapshot, and two symbol-getter regressions fail before the classification fix. Final validation passes 87 Node IPC tests and 53 Electron IPC tests after refreshing the 10 changed reachable source/support files from main. Focused lint, hygiene, and targeted TypeScript checks pass. Seven macOS CI jobs did not start because of GitHub runner/account restrictions, so they provide no macOS test coverage.

## Full-product correctness blocker

The Linux Electron integration job fails the existing task test `Execution from onDidEndTaskProcess and onDidStartTaskProcess are equal to original` after a 60-second timeout. Immediately beforehand, terminal `createProcess` fails to post a `waitOnExit` callback. The same job logs a language-detection workspace-diagnostics request whose ResourceMap contains an uncloneable callback. A minimal real ChannelClient/ChannelServer reproduction confirms that the old buffer transport omits an object callback and succeeds, while the current structured-clone transport rejects with DataCloneError. These requests need a compatibility decision or explicit data-only payloads before this can be considered ready. The candidate is not functionally equivalent on this coverage, so lower costs cannot establish a safe whole-product optimization: failed background work may also change CPU and timing windows. The compatibility failures remain unresolved, and the 87/53 focused test results must not be read as a complete correctness pass.

A minimal channel argument is `{ executable: 'echo', waitOnExit: (exitCode: number) => String(exitCode) }`. Send it through the existing echo channel fixtures: the buffer path returns `{ executable: 'echo' }`; the structured-clone path rejects with DataCloneError. This reproduces the transport incompatibility independently of the slower task integration test.

## Method and build validity

Linux x64, isolated profiles, shared-data directories and extension storage, Xvfb 1440×1000, and identical launch flags for both revisions. User-installed extensions are disabled; built-ins remain available. Launches expose Chromium CDP and Node inspector endpoints; absolute times include automation/debugging overhead. Startup ends at visible editor readiness, with expected editor text for workspace startup, while background initialization may continue. Interaction timing includes input dispatch and assertion polling. Each collector runs independently.

Cold samples clear page/dentry/inode caches immediately before spawn. Warm samples use an unmeasured prime launch on their isolated profile. Pair order alternates; a 15-second stable-idle guard and in-sample E2E-overlap monitor protect local collection. Ordinary background load remains a source of variance. Main/after samples are paired by index; means summarize counts/bytes and medians summarize durations. The shared analysis uses 10,000 deterministic paired bootstrap resamples, without outlier removal.

Both fresh native minified build jobs succeeded. Archive checksums, embedded source commits, all 34 desktop extension entrypoints, the codicon font, the Copilot SDK/native shim, and equal Electron binary hashes were independently verified before local measurement. Both builds use the same explicit build-only Copilot packaging adjustment and restore tracked build source afterward. The initial helper that accepted a failed gulp exit once an executable existed was corrected, and its rejected packages are excluded. Linux compile-cache generation is disabled by these source revisions. The harness runs Node 24.15.0; the product build selects its declared Node 24.18.0.

## Separate historical experiments and reproduction

The earlier snapshot `3c9db188` campaign collected 56 of 105 planned cloud blocks and 888 local primary samples before being stopped to prioritize corrected code. Its data remains in `ipc.product.perf.results.json`, separate from the current results. Four earlier file-opening timeouts occurred on both revisions and remain recorded. Its warm-workspace cloud startup signal was also modest; it must not be pooled with current absolute timings.

The initial marshalling-only optimization report and 64 process results are in `ipc.perf.md` and `ipc.perf.results.json`. It compares IPC modules against structured-clone parent `5f0eb30e`, not main. Its object-heavy fixture remains about 2.2 times the legacy buffer path before the later correctness fixes. Additional envelope removal was inconclusive and was not adopted.

The two incremental correctness microbenchmarks are in `ipc.correction.perf.results.json`: eight randomized paired process blocks each, native Node MessagePort, three batches of 500 round trips after 200 warm-up calls, and payload assertions. The mutation fix adds measurable cost for settings, URIs, VSBuffer and the small cyclic Map/Set graph. The classifier is adopted for correct symbol-getter handling rather than a general speedup. All 32 processes were valid. Do not multiply estimates from separate campaigns into a direct current-head performance comparison.

These module-only microbenchmarks share supporting JavaScript from initial optimization build `137580c6`; only selected IPC modules vary. Their compiled module digests and supporting-context refresh record are preserved. Full-product comparisons use complete fresh packages, and the final focused test pass uses refreshed reachable dependencies.

Current normalized samples, metric definitions, full paired summaries, tail statistics, and package provenance are in `ipc.product.perf.current.results.json`. Reconstruct a metrics array by combining each sample metric value with its named definition; absent metrics stay absent. The artifact generator verifies exact reconstruction of every original result. Full raw logs and profile evidence remain in the matching workflow artifacts and local investigation directory. The large-performance workflow branch `perf/ipc-comparison-build-validation` supports both report-only rendering and reuse of verified build artifacts for additional experiments.
