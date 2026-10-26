# Current-core public API comparison

This measures the incremental change from [a167](https://github.com/SimonSiefke/vscode/commit/a167347ebc4ab8923c027674f602a4f74d39ada5) to [AAC](https://github.com/SimonSiefke/vscode/commit/aac6b0fcf3bc6714c8cd7e7dd9fa1bfe6618ba25). It is separate from the older original-baseline cumulative results, the nineteen-method metadata followup, later metadata, and all private prototypes. Exact archived application packages and their archive hashes are retained. Their executable hashes can match because the Electron launcher is shared; the archive hashes identify the differing bundled VS Code resources.

Each schedule and fixture has an independent identical-package A/A control with ten pairs, followed by fifty fixed before/after pairs. All 960 unprofiled application processes and 16 plumbing launches are retained. Counts cover inherited application user/kernel retired instructions during fixed completed public API work, after the recorded startup/warmup/GC boundaries. Instructions measure work, not CPU seconds. Elapsed time is distinct. No outlier filtering, missing-window replacement, post-hoc warmup change, or pooling across schedules is used.

The tables show paired median percentage changes and 95% intervals. User/kernel intervals use the primary bootstrap procedure; total instruction and elapsed intervals use the conservative sign/order-statistic procedure. They are descriptive without a multiple-comparison correction. Interpret small apparent wins against the complete A/A controls, whose false positives remain visible.

## Fixed fifty-pair comparisons

| Schedule | Fixture | User instructions | Kernel instructions | Total instructions | Elapsed |
| --- | --- | --- | --- | --- | --- |
| batch32 | context-unchanged | -8.171% [-8.424, -7.924] | -25.457% [-26.366, -24.491] | -9.218% [-9.496, -8.868] | -1.837% [-5.002, +1.301] (inconclusive) |
| batch32 | context-changing | -1.548% [-1.602, -1.511] | -17.238% [-17.920, -16.847] | -1.757% [-1.826, -1.694] | -0.093% [-2.113, +2.069] (inconclusive) |
| batch32 | clipboard-64KiB | -0.069% [-0.152, +0.035] (inconclusive) | +0.372% [-0.188, +0.826] (inconclusive) | +0.107% [-0.126, +0.203] (inconclusive) | -0.025% [-1.326, +1.155] (inconclusive) |
| batch32 | clipboard-write-64KiB | -6.166% [-6.194, -6.137] | -0.070% [-0.799, +0.469] (inconclusive) | -5.578% [-5.645, -5.513] | -1.856% [-2.886, -0.506] |
| direct await1 | context-unchanged | -22.867% [-25.486, -19.684] | -20.146% [-21.079, -19.043] | -22.485% [-23.989, -17.266] | -2.540% [-5.742, +1.145] (inconclusive) |
| direct await1 | context-changing | -11.151% [-11.203, -11.080] | -20.706% [-21.445, -20.150] | -12.088% [-12.188, -11.927] | -4.196% [-5.363, -1.594] |
| direct await1 | clipboard-64KiB | +0.056% [-0.161, +0.189] (inconclusive) | +0.000% [-0.738, +0.414] (inconclusive) | -0.034% [-0.364, +0.297] (inconclusive) | -0.681% [-3.632, +1.324] (inconclusive) |
| direct await1 | clipboard-write-64KiB | -4.234% [-4.260, -4.196] | +0.710% [-0.584, +1.841] (inconclusive) | -3.803% [-3.915, -3.603] | -2.085% [-3.536, -1.178] |

## Identical-package A/A controls

| Schedule | Fixture | User instructions | Kernel instructions | Total instructions | Elapsed |
| --- | --- | --- | --- | --- | --- |
| batch32 | context-unchanged | -0.088% [-1.438, +0.608] (inconclusive) | -1.410% [-2.328, +4.290] (inconclusive) | -0.084% [-2.685, +1.339] (inconclusive) | -2.216% [-7.673, +9.602] (inconclusive) |
| batch32 | context-changing | +0.067% [-0.049, +0.312] (inconclusive) | +1.842% [-0.878, +3.151] (inconclusive) | +0.096% [-0.102, +0.364] (inconclusive) | +3.696% [-0.506, +5.537] (inconclusive) |
| batch32 | clipboard-64KiB | -0.049% [-0.398, +0.171] (inconclusive) | +0.082% [-1.476, +0.362] (inconclusive) | -0.193% [-0.572, +0.364] (inconclusive) | -1.599% [-5.337, +1.681] (inconclusive) |
| batch32 | clipboard-write-64KiB | -0.097% [-0.191, -0.033] | -0.450% [-1.421, +0.286] (inconclusive) | -0.117% [-0.325, +0.024] (inconclusive) | +1.047% [-4.584, +2.758] (inconclusive) |
| direct await1 | context-unchanged | +0.372% [-10.417, +13.267] (inconclusive) | -0.640% [-3.782, +1.575] (inconclusive) | +0.495% [-16.012, +19.178] (inconclusive) | -1.479% [-13.482, +9.030] (inconclusive) |
| direct await1 | context-changing | -0.092% [-0.255, +0.063] (inconclusive) | -0.217% [-3.626, +0.632] (inconclusive) | -0.282% [-0.555, +0.152] (inconclusive) | +0.147% [-10.195, +7.425] (inconclusive) |
| direct await1 | clipboard-64KiB | -0.022% [-0.110, +0.326] (inconclusive) | -0.160% [-2.266, +0.128] (inconclusive) | -0.204% [-0.758, +0.107] (inconclusive) | -2.888% [-6.869, -1.545] |
| direct await1 | clipboard-write-64KiB | +0.014% [-0.064, +0.632] (inconclusive) | -0.362% [-2.449, +2.935] (inconclusive) | +0.190% [-0.299, +0.678] (inconclusive) | -0.380% [-6.801, +4.546] (inconclusive) |

The direct-await unchanged-context user-instruction samples have distinct process-level bands, also visible in the identical-package control. Its A/A interval is wide (approximately -10.42% to +13.27%). The fixed fifty-pair comparison reports a paired median change of -22.87% [-25.49%, -19.68%], with reductions in both run-order subgroups, but the separate label medians are 395,347 and 371,391 instructions per call. The ratio of those separate medians is a different statistic from the median of paired log-ratios. All samples, both bands, original intervals and an explicit per-pair distribution/order review are retained. No band was filtered, no warmup was changed, and the cause of the bands is not established. This result is not a general latency or startup improvement.

Twenty-four separate CPU profiles from eight empty/private-workspace startup launches are diagnostic sampled stacks only and excluded from every instruction/elapsed estimate. A separate timing-quality recovery preserves the original strict-analysis failure and disables weighted attribution for any entire profile containing invalid timestamp deltas. Such profiles retain unweighted sample counts; negative deltas are never clamped, removed or repaired. Other profiles retain their original timing weights. Their debugger/profile windows differ between isolates; raw profiles, traffic/hook coverage and available analyses are retained. Missing hooks or names do not prove zero IPC, and sampled weights are not hardware CPU accounting. These startup diagnostics do not establish a startup or full smoke-suite speedup.

The complete bundle includes raw sample results, counters, logs, exact fixture/collector scripts and hashes, package metadata, orchestration-only pause/resume journals, all startup profiles and available diagnostic analyses. Only whole campaign orchestration was held at the recorded 300-, 100- and 20-process boundaries; no measured child was paused or repeated. A later missing-browser-coverage repair also held only orchestration until the second-label application child exited successfully; its pre-annotation raw sample, final CSV and disposable ownership/exit-code probe are retained. The second raw coordinator log contains an inherited `300` print typo; its hard assertions and actual manifest require 100 and are preserved unchanged.

Archive SHA-256: `65a17776155bb443349b01ef6b233456e11f85c2404e3ae3af4ea1d02c03bbd9`.
