# Isolated structured-clone RPC: current evidence

Runtime source: `51918aaf5d0d54b7b00f3777e26e5eac98b200b7`. The legacy RPC engine and three byte transport implementation files match base `416e5d6b0db90081fddd1d62c9a905cdeb9ebcff`. All ordinary RPC comparisons use these engines on the same candidate dependency graph; they isolate engine behavior rather than all application changes. UI compares complete development builds at that base and the candidate source, with the same frozen harness and fixtures.

## Validation

- Client typechecking and targeted lint (43 files) pass. Source commits pass normal index hygiene.
- Final focused Electron tests: 292 passing, 0 pending.
- Broader extension API Electron tests: 1077 passing, 3 pending. These suites overlap the focused run; counts are not added as unique tests.
- Policy/native managed settings tests: 23 passing. The repository layer checks pass.
- Both complete development builds have all 34 built-in desktop entrypoints and the codicon font. The isolated driver uses its declared Node version; product commands use the product's declared Node version.
- New regressions cover threshold/nested getters, primed real-port terminal start/data/end with the actual stream reader, provider error classifications, exact file bytes and offsets, early native frames during handshakes, reentrant FIFO delivery, disposal, and native actor cancellation.

## Fixed completed RPC work

800 independent unprofiled Node target processes (plus four plumbing processes), each with a real MessagePort peer in a worker thread, complete 6,553,600 measured RPCs. Each fixture/schedule has a separate ten-pair identical-engine A/A control and twenty fixed three-label comparisons: byte, native without batching, and native with batching. Every process completes 4,096 warmup calls, GC before counting, and 8,192 measured calls. Returned fixture values and exact completed actor counts are validated. Both user and kernel instructions cover the target process and inherited threads with at least 99% counter coverage.

Instructions measure work rather than CPU seconds. The table shows paired median changes; [all conservative intervals and controls](focused-comparison-summary.json) also report CPU time, elapsed time, packets and the batching increment. No multiple-comparison correction is applied. No samples, bands or unfavorable fixtures are removed. Runtime/harness source identities and all original counters/logs are included.

| Fixture | Sequential instructions | Sequential elapsed | Batch-32 instructions | Batch-32 elapsed |
| --- | ---: | ---: | ---: | ---: |
| primitive | -43.8% | -16.1% | -69.2% | -72.3% |
| small-object | -37.6% | -15.8% | -57.2% | -63.6% |
| text-64KiB | -93.2% | -72.5% | -91.4% | -77.4% |
| binary-64 | -10.2% | -6.8% | -3.0% | -27.0% |
| binary-64KiB | -5.0% | +5.5% | +1.3% | -13.1% |

The 64-KiB binary results are mixed: sequential elapsed increases and batched instructions increase, with variation overlapping the corresponding A/A controls. These possible costs remain visible; there is no universal binary performance claim. The source uses an explicit byte-codec envelope for binary RPC and does not batch those buffers. The unbatched/batched binary contrast itself is inconclusive; no causal attribution is made from a noisy timing difference. No source change was selected by dropping those rows.

## Allocation diagnostic

Both real Node MessagePort peers run in one isolate for this separate diagnostic. Six fresh processes per label/fixture profile 1,000 completed ordinary sequential RPCs after 4,096 warmup calls and GC, using interval-1 V8 sampling with collected objects included. These are sampled JavaScript allocation estimates, excluding native/external allocation and retained memory. Disposable-construction tracking is instrumented diagnostic evidence, not an unprofiled timing result.

- primitive: byte 5913.3, native unbatched 3433.4, native batched 3431.5 sampled JS bytes/call (-42.0% for native batched).
- small-object: byte 6455.6, native unbatched 4058.4, native batched 4061.7 sampled JS bytes/call (-37.1% for native batched).

Three independent count-doubling calibration profiles use 2,000 calls. The per-call estimates remain within approximately 2% of the corresponding 1,000-call medians. All 39 profiles and constructor/traffic diagnostics are retained. `backingBytes` counts raw byte-array backing stores only; it is not a comparable native wire-size measurement.

## Real Electron UI

Six plumbing/pilot launches pass before expanding to sixteen identical-build control launches and sixteen balanced before/after launches. Every full launch runs both originally non-skipped scenarios exactly 37 times: 2,368 full-campaign actions plus 36 pilot actions. Every launch has a fresh profile, zero failed/skipped actions, and no detected built-in extension activation error. Profile contents and unrelated user state are excluded from publication; timings, commands and logs are retained.

The independent application launch is the statistical unit. The table compares the sum of all 37 measured action durations in each scenario. Per-launch action medians are retained as a separate descriptive estimate. Setup/teardown and total CLI duration are recorded separately. Timing excludes heap snapshots, allocation instrumentation and forced GC; the harness's memory path is gated off. Action timings still include UI automation and polling, and total suite duration includes substantial readiness/setup overhead. These two scenarios do not establish a whole-suite or startup speedup.

| Scenario | 37-action total, paired change and conservative interval | A/A control |
| --- | ---: | ---: |
| activity-bar-toggle | -0.5% [-6.8%, +10.3%] | +4.1% [-0.4%, +8.5%] |
| editor-open | -0.3% [-8.4%, +4.6%] | +1.0% [-8.7%, +13.9%] |

The fixed scenario list, harness patch, exact commands and launch order were frozen before the UI campaign. Completed operations within a launch are correlated and are not treated as 37 independent samples. The shared host is not exclusively reserved or CPU-pinned; controls and full distributions remain part of the result.

## Reproduction and historical evidence

See `measurement-plan*.json`, `rpc-source-identity.json`, `rpc-runtimes.json`, `rpc-harness/`, `rpc-binary-harness/`, `run-ui-comparison.py`, `ui-timing-harness.patch`, and the per-phase manifests. Paths identify the original local worktrees; use the recorded revisions and adapt roots when reproducing. `summarize-comparisons.py` computes paired log-ratio medians with conservative binomial/order-statistic intervals. Unprofiled RPC, allocation and UI scopes remain separate and their gains are not multiplied.

Earlier packaged API, startup, smoke and allocation experiments remain historical evidence under `performance/20261025` on the existing evidence branch. They do not establish the performance of this refactored source.
