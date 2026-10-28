# Structured-clone IPC and RPC measurements

Current evidence supports primitive/small-object RPC work and JavaScript allocation reductions. UI timing is inconclusive, and binary results are mixed. There is no whole-product startup or smoke-suite speedup claim.

The implementation has a standalone `StructuredCloneRPCProtocol`, explicit native transports, bounded small-frame batching, audited notifications and observed promises. The legacy RPC engine and three existing byte transport implementation files match base `416e5d6b0db90081fddd1d62c9a905cdeb9ebcff`. See the [transport, acknowledgement and per-method audit](../../../../../workbench/services/extensions/common/structuredCloneRPCProtocol.md).

## Fixed completed RPC work

The runtime source is `51918aaf5d0d54b7b00f3777e26e5eac98b200b7`; subsequent documentation changes do not alter it. Ordinary RPCs compare the byte engine and native engines on the same dependency graph, with batching disabled and enabled separately. This isolates RPC behavior rather than all API optimizations in the application.

Each fixture/schedule has ten independent identical-engine A/A pairs and twenty fixed three-label comparisons. All 800 unprofiled Node target processes, plus four plumbing launches, are retained. Real MessagePort peers run in a worker thread; 4,096 warmup calls and GC precede each 8,192-call measured window. The measured windows complete 6,553,600 RPCs with validated fixed fixtures and exact actor counts. Both user and kernel instructions include inherited threads with at least 99% counter coverage.

Instructions measure work rather than CPU seconds. Values below are paired median changes for native RPC with batching enabled versus the byte engine. Conservative 95% order-statistic intervals, A/A distributions, CPU time, packet counts, and the unbatched/batching comparisons remain in the full report. There is no multiple-comparison correction.

| Fixture | Sequential instructions | Sequential elapsed | Batch-32 instructions | Batch-32 elapsed |
| --- | ---: | ---: | ---: | ---: |
| primitive | -43.8% | -16.1% | -69.2% | -72.3% |
| small-object | -37.6% | -15.8% | -57.2% | -63.6% |
| text-64KiB | -93.2% | -72.5% | -91.4% | -77.4% |
| binary-64 | -10.2% | -6.8% | -3.0% | -27.0% |
| binary-64KiB | -5.0% | +5.5% | +1.3% | -13.1% |

The 64-KiB binary cases have possible costs: sequential elapsed is +5.5% [+0.4%, +9.6%], and batch-32 instructions are +1.3% [+0.5%, +4.9%]. Both overlap the respective A/A variation. The binary unbatched/batched contrast is inconclusive; no causal explanation is established. These rows are retained, and no universal binary improvement is claimed.

## Allocation diagnostic

A separate interval-1 V8 diagnostic estimates 42.0% fewer JavaScript bytes per primitive RPC and 37.1% fewer per small-object RPC. Each label/fixture has six fresh processes, with 1,000 completed ordinary sequential RPCs after 4,096 warmup calls and GC. Both real MessagePort peers run in the same isolate. Native/external allocation and retained memory are excluded; these are sampled estimates, not exact total allocations or CPU measurements.

Three independent 2,000-call calibration profiles keep per-call estimates within approximately 2% of the 1,000-call medians. All 39 profiles and diagnostic constructor/traffic counts are retained.

## UI integration and validation

The complete development builds compare the pinned base with the runtime source above, using frozen harness `a76c1e02df184d81aa79da2e83d6f51bac52bfbb` plus the archived timing patch. Six pilot launches pass before sixteen identical-build controls and sixteen balanced baseline/candidate launches. All 2,404 actions pass across 38 fresh-profile launches, with no detected extension activation errors. Both scenarios were originally non-skipped.

Each full launch executes both scenarios exactly 37 times. The independent launch is the statistical unit. The table compares the sum of all 37 action durations; per-launch medians, setup/teardown timings, total suite durations, failures/timeouts policy and exact commands are retained separately. Timing runs have no snapshots, forced GC or allocation instrumentation. Action timings include UI automation and polling; total suite duration includes substantial readiness/setup overhead.

| Scenario | 37-action total, paired change and conservative interval | A/A control |
| --- | ---: | ---: |
| activity-bar-toggle | -0.5% [-6.8%, +10.3%] | +4.1% [-0.4%, +8.5%] |
| editor-open | -0.3% [-8.4%, +4.6%] | +1.0% [-8.7%, +13.9%] |

The UI intervals include zero. These two scenarios establish integration compatibility without establishing a whole-suite or startup gain. The shared host is neither exclusively reserved nor CPU-pinned; controls and all original samples remain included.

Final validation passes 292 focused Electron tests, 1,077 extension API tests with three pending, and 23 policy/native-settings tests. Suites overlap, so these are separate run counts. Client typechecking, targeted lint (43 files), layer checks and normal source commit hygiene pass. Both runnable development builds have all 34 built-in desktop entrypoints and the codicon font. Regressions cover getters, real-port terminal output, provider errors, file bytes/offsets, handshake buffering, reentrant FIFO delivery, cancellation, disposal and observed completions.

[Current report, all controls, exact source/runtime identities, harnesses, raw counters/logs and profiles](https://github.com/SimonSiefke/vscode/blob/6f97187c8d8a7a4974defbca9fde1187f184d9e2/performance/20261028/refocus/REPORT.md). Earlier packaged API, startup, smoke and allocation experiments remain on the [existing evidence branch](https://github.com/SimonSiefke/vscode/tree/perf/ipc-evidence-20261025/performance/20261025) with their original scopes. Their gains are not multiplied with the current results.
