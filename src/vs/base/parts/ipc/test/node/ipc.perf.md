# IPC performance evidence

Raw historical benchmark samples, source snapshots, held experiments and smoke diagnostics are preserved on [the evidence branch](https://github.com/SimonSiefke/vscode/tree/perf/ipc-evidence-20261025), frozen at `cfe956a300ea61706f2969835de2c886a75474a2`. They are excluded from this implementation diff.

The strongest completed corrected-harness comparison for production commit `38b2f1066eedc6cd3395bda950ee1f7e292f9df7` measured a 1.98% lower full-smoke median over eight paired comparisons against upstream `4df8bb183f0e984e97d8f4200c802c49061d7d3c`. Whole-smoke duration is noisy and is supporting evidence, not the optimization acceptance criterion. No 10–20% whole-product improvement has been established.

Further measurements use actual MessagePort transports with the Linux product buffer pool, fixed payloads, deterministic returned-value and message-count checks, randomized paired order, warmup, and fresh-process replication. Latency/throughput and CPU cost are measured without profiling; allocation sampling and CPU profiles run separately. Startup comparisons use at least 50 paired samples, report dispersion and paired confidence intervals, and keep fixture, cache policy and readiness boundaries equal. Cold and warm startup remain separate.

Small-message batching, FIFO delivery, binary/control flushing and cancellation remain covered by regression tests. Changes are selected only after ordinary and mixed-message controls are measured alongside the targeted workload.

The additional audited notifications cover filesystem watcher registration/disposal, terminal environment updates, tool registration/progress and chat status. An actual watcher lifecycle over real RPC peers reduces ignored empty replies from two to zero while preserving watch-before-unwatch ordering. SCM updates retain completion replies because callers release old command resources in `finally` callbacks. Combined transport/API/authentication validation: 1,496 passing, three pre-existing pending.

## Repeated startup comparison

[Run 40204577508](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40204577508) compares upstream `4df8bb183f0e984e97d8f4200c802c49061d7d3c` with `6e1e253fc47b04643a6bee09f445ed32753f7448`. Each scenario has 50 alternating pairs on one runner, with matching fixtures/cache policy and extensions disabled. All 400 measured launches pass; all samples remain included. These results precede the subsequent notification increment.

| Startup scenario | Before mean → after mean (ms) | Before median → after median (ms) | Median change | Exploratory 95% paired interval for median difference (ms) |
| --- | ---: | ---: | ---: | ---: |
| Empty, cold | 2652.71 → 2595.90 | 2597.96 → 2587.88 | −0.39% | [−27.27, +24.01] |
| Empty, warm | 807.11 → 799.38 | 799.72 → 795.70 | −0.50% | [−21.56, +13.43] |
| Workspace, cold | 3192.42 → 3079.12 | 3076.57 → 3069.38 | −0.23% | [−44.18, +31.13] |
| Workspace, warm | 1265.48 → 1233.46 | 1264.09 → 1217.91 | −3.65% | [−67.87, −17.02] |

Only warm workspace startup excludes zero in this campaign; the other three scenarios are inconclusive. Means, especially cold-start means, are sensitive to the early large samples. The intervals are exploratory and are not corrected for multiple comparisons. Startup includes readiness polling and measures the complete product, rather than isolating RPC overhead.

## Fixed-work retired-instruction confirmation

The compact-frame increment `18f8cde2f9d038bd1fb4b868a381fea98ea1aca8` is compared with `218b977159b5a4bc24268ca3c12795e6f6d5437d` using separate frozen runtime copies and matching esbuild ES2024/ESM options. Real worker-thread MessagePorts carry the actual RPC protocol and batching adapter. Each fixture has 50 independent paired processes, balanced variant order, randomized fixture order, 16,384 warmup calls and 32,768 measured calls at concurrency 32. Both isolates collect garbage before counting begins. Every process validates the returned value and the remote handler's exact measured call count.

Linux `perf stat` counts retired userspace instructions across the target process and inherited worker/JIT/GC threads. FIFO control disables counting during startup and warmup. A worker-only arithmetic probe verifies inherited-counter coverage. Identical-code A/A comparisons are retained; their userspace intervals include zero. Allocation sampling and timing diagnostics run separately. This isolates RPC CPU work and does not include real provider, disk or network work.

| Fixture | Baseline median instructions/call | Compact median instructions/call | Median paired change | Exploratory 95% paired interval |
| --- | ---: | ---: | ---: | ---: |
| Primitive | 47,225 | 38,646 | −18.14% | [−18.52%, −17.80%] |
| Small object | 62,798 | 54,395 | −13.67% | [−13.90%, −13.02%] |
| Settings object, 100 keys | 1,460,639 | 1,452,142 | −0.59% | [−0.70%, −0.51%] |

Changes and intervals use paired log-ratios, with 10,000 bootstrap resamples and no multiple-comparison correction. Counts of instructions are distinct from elapsed time. Early broader direct-clone and larger-batch experiments retain their regressions and are not shipped. The selected change keeps JSON payload semantics and the 16 Ki-character/64-frame batch bounds.

Separate V8 allocation sampling (1,024-byte interval, including objects collected by minor and major GC) runs three fresh processes per variant/fixture and 10,000 real MessagePort RPCs per process. Both peers share one process for this diagnostic. Estimated median allocated bytes/call change from 4,013 to 3,161 (−21.24%) for primitive replies and 4,547 to 3,672 (−19.25%) for small objects. The disposable tracker separately records exactly 10,000 per-call `DisposableStore` constructions in every baseline process and zero in every compact process. Sampled bytes are estimates, not retained heap or complete-product memory measurements; tracked constructor counts are exact.

[Complete raw evidence, frozen runtimes and reproduction instructions](https://github.com/SimonSiefke/vscode/tree/1b7746ad33021ff281ff7a8ffafc7a3a00f63a8d/performance/20261025) are archived separately from the implementation diff. The selected increment passes 251 Node transport tests and 1,498 combined Electron/API/authentication tests (three pre-existing pending), final client typechecking and targeted lint. Wide request-ID tests fail against the preceding array-header format and pass with arithmetic packing, covering IDs above the bitwise-shift boundary.

## Compact-only startup confirmation

[Run 40209708548](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40209708548) isolates `218b977159b5a4bc24268ca3c12795e6f6d5437d` → `18f8cde2f9d038bd1fb4b868a381fea98ea1aca8`. All 400 measured launches succeed, with 50 alternating pairs per scenario, matching cache policy and no excluded samples.

| Startup scenario | Before mean → after mean (ms) | Before median → after median (ms) | Median change | Exploratory 95% paired interval for median difference (ms) |
| --- | ---: | ---: | ---: | ---: |
| Empty, cold | 2836.21 → 2629.05 | 2612.09 → 2616.43 | +0.17% | [-16.59, +28.86] |
| Empty, warm | 916.82 → 917.37 | 912.76 → 907.67 | -0.56% | [-16.11, +5.37] |
| Workspace, cold | 2018.50 → 1955.70 | 1946.89 → 1938.56 | -0.43% | [-21.57, +9.20] |
| Workspace, warm | 1605.39 → 1591.85 | 1576.51 → 1574.12 | -0.15% | [-28.95, +11.02] |

All four intervals include zero: this campaign establishes no detectable startup gain from compact frames. The cold-empty baseline includes a 13.46-second first launch, retained in both the raw data and mean. The lower RPC instruction/allocation measurements must not be described as a complete-product startup improvement. A [follow-up instruction and CPU-profile run](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40212599206) reuses the exact packaged builds.

## Renderer/utility instruction confirmation

The same exact-source comparison also runs through real MessagePorts between a Node-disabled Electron renderer and a utility process. Fifty independent pairs per fixture use the same warmup, measured call counts, concurrency, GC gates and value/request-count checks. Counters include inherited application processes and threads, with Xvfb excluded. All 300 processes validate 32,768 measured remote calls and all counters run 100% of the measured interval.

| Fixture | Baseline median instructions/call | Compact median instructions/call | Median paired change | Exploratory 95% paired interval |
| --- | ---: | ---: | ---: | ---: |
| Primitive | 50,016 | 42,750 | -14.52% | [-14.60%, -14.50%] |
| Small object | 62,953 | 55,860 | -11.29% | [-11.44%, -11.23%] |
| Settings object, 100 keys | 1,282,923 | 1,272,028 | -0.87% | [-0.95%, -0.78%] |

The separate 10-pair identical-code renderer A/A calibration has all three userspace intervals crossing zero. [Complete renderer and compact-startup evidence](https://github.com/SimonSiefke/vscode/tree/210d58a7f6abf05d4edb2c605e2c804fa507cd6f/performance/20261025/confirmation) includes raw counters, process logs, frozen harness files, all startup launches and file/archive checksums. These results confirm lower RPC CPU work in both transport topologies; the compact-only startup campaign above remains inconclusive.

## Direct native receive confirmation

The subsequent `ac92d647915e8434b3f9d17f957796cab32d3c03` increment receives native frames directly, retaining the existing byte event for other consumers. Compared with compact frames `18f8cde2f9d038bd1fb4b868a381fea98ea1aca8`, each topology has another 50 independent paired processes per fixture with identical 16,384-call warmup, 32,768-call measured workload and concurrency 32. All 600 processes validate values and exact remote call counts; all counters run 100% of their measured interval.

| Fixture | Node user-instruction change (exploratory 95% interval) | Renderer/utility change (exploratory 95% interval) |
| --- | ---: | ---: |
| Primitive | -11.74% [-11.93%, -11.38%] | -8.88% [-8.91%, -8.85%] |
| Small object | -8.33% [-8.69%, -8.18%] | -6.71% [-6.74%, -6.66%] |
| 100-key settings | -0.25% [-0.30%, -0.17%] | -0.19% [-0.21%, -0.12%] |

Separate 12-pair Node controls reduce primitive/small-object instructions by 12.19%/8.69% for resolved promises and 7.13%/5.81% for next-task deferred handlers. Resolved settings is inconclusive; deferred settings improves 0.45%. They are distinct workloads and are not pooled with synchronous results. [All confirmation samples, counters, exact driver files and checksums](https://github.com/SimonSiefke/vscode/tree/23c8d6a1a95fb593a9e3e83287d50fbc2c141b17/performance/20261025/direct-receive-confirmed) are preserved separately.

Four fresh allocation-sampling processes per version/fixture, 10,000 calls each, estimate median bytes/call of 3,143.98 → 2,868.13 (−8.77%) for primitives and 3,672.38 → 3,393.06 (−7.61%) for small objects. A separate constructor diagnostic counts 20,000 `VSBuffer` constructor invocations before and zero after for 10,000 calls in each fixture. Instrumentation can affect optimization; these constructor-counting runtimes are excluded from CPU and byte-sampling studies. [Diagnostic sources, profiles, exact counts and preliminary controls](https://github.com/SimonSiefke/vscode/tree/373ba888a572f5ccd82152c9c6b254250f89e490/performance/20261025/direct-receive) remain available.

Direct receive passes 293 Node transport tests and 1,540 Electron/API/authentication tests, with three existing pending, client typechecking, targeted lint and hygiene. Two direct receive buffering/disposal regressions fail against the preceding source; the complete RPC suite also covers the new receive event. Notification test actors reuse stable IDs so the expanded suite stays within the byte codec’s actor-ID range.

The preceding compact-frame packaged smoke comparison passes the same 62 tests with 68 pending in each version; one pair establishes compatibility rather than speed. The direct-receive [50-pair startup comparison](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40215506758) measures complete-product behavior separately. Hosted instruction collectors report unavailable hardware counters, and large-file profiling fails in both versions in Quick Open readiness; those failures remain in the diagnostic archive.


## Actual packaged API measurements

The same direct-receive comparison (`18f8cde2f9d038bd1fb4b868a381fea98ea1aca8` → `ac92d647915e8434b3f9d17f957796cab32d3c03`) now has fifty independent paired packaged-application processes per fixture. A development extension runs real public API calls, following five seconds of settling and 16,384 warmup calls. Each process completes and validates 32,768 measured calls at concurrency 32. Counters include the whole application process tree and inherited threads, excluding startup, warmup and Xvfb. Only the extension host explicitly collects garbage, so real handler/UI and background work remain included. All 200 processes validate and all counters run 100% of the measured interval.

| Actual API workload | Median paired user-instruction change | Exploratory 95% paired interval |
| --- | ---: | ---: |
| `setContext`, unchanged value | -1.96% | [-2.08%, -1.87%] |
| `setContext`, alternating value | -0.38% | [-0.43%, -0.34%] |

The separate ten-pair identical-package A/A calibration changes unchanged-context instructions by -0.016%, with interval [-0.28%, +0.68%], including zero. These public API workloads include real handlers; they measure a broader scope than isolated RPC CPU cost. The changing workload performs substantially more UI work. Neither result is a whole-smoke or startup speedup.

The direct-receive startup run completes 400 successful launches, fifty pairs in each scenario. Median changes are -1.15% empty/cold, -0.10% empty/warm, +2.28% workspace/cold and -0.97% workspace/warm. All four paired intervals include zero. The direct-receive [smoke compatibility run](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40217494355) passes the same 62 tests, with 68 pending in each version; its single-pair elapsed duration is not used to estimate performance.

A separate scalar-reply [startup run](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40221936330), comparing `ac92d647915e8434b3f9d17f957796cab32d3c03` → `37e23c02fb542e78dadf80a205dbada712e60406`, also completes 400 successful launches. Median changes are +0.12%, +0.61%, -0.74% and +0.51% in the same scenario order; all four intervals include zero. Scalar reply CPU/clipboard confirmation remains separate. This source increment passes 297 Node and 1,544 Electron/API/authentication tests, with three existing pending, typechecking, lint and hygiene.

[All packaged API/A/A samples, raw startup/smoke results, exact API fixture/harness and checksums](https://github.com/SimonSiefke/vscode/tree/e26ec2dd748c4df3e810fd274e8eeb2e290ea3be/performance/20261025/product-confirmation) are archived outside this implementation. Every startup sample remains included. These comparisons precede the later merge from `main`; no cross-base improvement is inferred and no 10–20% whole-product improvement is established.

The follow-up notification increment adds ten audited methods: diagnostic changes/clear and terminal disposal, visibility, input and process output/ready/property/exit updates. Actual `DiagnosticCollection` and `TerminalDataBufferer` regressions observe three and two ignored replies before the metadata change, respectively, and zero afterward, preserving change/disposal and buffered-output-before-exit order. Completion-bearing terminal creation remains ordinary RPC. On the PR's subsequent existing merge from `main`, validation passes 297 Node and 1,562 Electron/API/authentication tests (three existing pending), using the refreshed Electron 43.8.3 runtime. The additional tests from `main` account for the different suite total; older benchmark snapshots retain their matching Electron 43.7.7 binary.
