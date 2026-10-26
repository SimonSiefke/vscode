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

## Scalar reply confirmation

The `37e23c02fb542e78dadf80a205dbada712e60406` increment passes native null/string/boolean/number replies directly, preserving JSON number normalization and object/buffer/error fallbacks. Compared with `ac92d647915e8434b3f9d17f957796cab32d3c03`, each topology/fixture has fifty independent pairs. Ordinary fixtures use 16,384 warmup and 32,768 measured calls; string fixtures use 4,096 warmup and 8,192 measured calls, all at concurrency 32. All 1,200 processes validate returned values and exact remote call counts, and all counters run 100% of their measured interval. Node uses version 24.22.0; renderer/utility uses the preserved Electron 43.7.7 runtime. These comparisons precede the later merge from `main`.

| Fixture | Node user-instruction change (exploratory 95% interval) | Renderer/utility change (exploratory 95% interval) |
| --- | ---: | ---: |
| Primitive | -4.19% [-4.53%, -3.73%] | -4.77% [-4.81%, -4.72%] |
| Small object | +0.095% [-1.268%, +0.334%], inconclusive | -0.038% [-0.056%, -0.002%] |
| 100-key settings | +0.067% [+0.009%, +0.157%] | -0.028% [-0.093%, +0.031%], inconclusive |
| 4 KiB string | -33.22% [-33.29%, -33.16%] | -18.06% [-18.12%, -18.00%] |
| 64 KiB string | -46.43% [-46.49%, -46.31%] | -36.82% [-36.99%, -36.66%] |
| Escaped text | -45.72% [-45.73%, -45.70%] | -41.13% [-41.29%, -41.06%] |

The small Node settings regression is retained. Supplementary fixed-work elapsed time falls by 24.57% / 29.52% / 30.73% in Node and 9.66% / 9.54% / 26.39% in renderer/utility peers for the three string fixtures; all six paired intervals exclude zero. Ordinary-fixture elapsed intervals include zero. Node total process CPU time falls by 24.38% / 33.26% / 32.15% for strings. Node 64 KiB kernel instructions increase 15.19%; summed user plus kernel instructions fall 43.63%. Instructions, CPU time and elapsed time are distinct metrics, and none is a whole-product speedup.

[All exact-source samples, counters, supplementary timing tables, runtime/harness hashes and compatibility controls](https://github.com/SimonSiefke/vscode/tree/3aa10148e76fcf9da80ef67798b959abf8ceb1ad/performance/20261025/scalar-replies-confirmed) are archived separately. Intervals use 10,000 paired bootstrap resamples without multiple-comparison correction. Scalar [smoke compatibility run 40227240697](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40227240697) passes the same 62 tests with 68 pending in both packages; its single-pair duration is not used to estimate speed.

A hosted [software-counter probe](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40230499876) completes twenty warm-workspace launches with process-tree task-clock, faults/context switches and PSS, with no partial samples or diagnostics. Its ten-pair CPU-time comparison is inconclusive. These software counters work where the earlier hosted hardware-instruction probes were unavailable. A [cumulative 50-pair startup CPU/resource comparison](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40231788062) compares the original upstream package with the selected scalar package using four cold/warm empty/workspace scenarios, reusing packages from separate build runs.

## Cumulative startup CPU and merged-base compatibility

The completed [cumulative software-resource run 40231788062](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40231788062) compares original upstream `4df8bb183f0e984e97d8f4200c802c49061d7d3c` with selected scalar source `37e23c02fb542e78dadf80a205dbada712e60406`, before the later merge from `main`. Each scenario requests 50 alternating pairs. Counters cover the application process tree from spawn to visible-workbench readiness and are disabled before shutdown. Task-clock sums CPU time across threads and processes; it is distinct from elapsed startup time.

| Startup scenario | Complete CPU pairs | Median CPU time before → after (ms) | Median change | Exploratory 95% paired interval for median difference (ms) |
| --- | ---: | ---: | ---: | ---: |
| Empty, cold | 50 | 3953.82 → 3941.76 | -0.30% | [-56.15, +20.34], inconclusive |
| Empty, warm | 48 | 2371.29 → 2334.73 | -1.54% | [-66.70, -4.10] |
| Workspace, cold | 50 | 4839.14 → 4706.51 | -2.74% | [-169.71, +17.91], inconclusive |
| Workspace, warm | 50 | 3403.30 → 3277.95 | -3.68% | [-145.38, -79.95] |

All 400 launches retain resource samples; 398 have CPU counters. Baseline empty/warm pairs 20 and 36 have empty perf output and explicit partial-sample diagnostics. The empty/warm CPU comparison uses the 48 complete pairs, retaining missing-window diagnostics and unmatched after-side measurements. No failed window is replaced with zero or selectively rerun. All raw metric types, logs and sampled PSS remain available in the run artifacts. PSS is sampled every 250 ms, can miss brief peaks, and does not measure allocated bytes. Intervals use the benchmark's paired median-difference bootstrap; there is no multiple-comparison correction.

The ten-method notification increment separately compares the PR's existing main-merge commit `a5e2a60eac7f5f5f819a0021145bd74868c739fb` with `a167347ebc4ab8923c027674f602a4f74d39ada5`. Its [50-pair startup timing run 40228551273](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40228551273) completes all 400 launches; all four paired intervals include zero. Its [smoke compatibility run 40234587600](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40234587600) passes the same 62 tests, with 68 pending, in both packages. That single smoke pair is a compatibility control, not a performance estimate.

A further [50-pair software-resource run against the PR's current base](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40240099034) compares `416e5d6b0db90081fddd1d62c9a905cdeb9ebcff` with `a167347ebc4ab8923c027674f602a4f74d39ada5`. It measures the cumulative pushed implementation on the merged codebase separately from the original-base comparison above. The completed run has 400 resource samples and 399 CPU windows:

| Current-base startup scenario | Complete CPU pairs | Median CPU time before → after (ms) | Median change | Exploratory 95% paired interval for median difference (ms) |
| --- | ---: | ---: | ---: | ---: |
| Empty, cold | 50 | 3582.26 → 3559.96 | -0.62% | [-54.44, +2.55], inconclusive |
| Empty, warm | 49 | 2303.37 → 2279.49 | -1.04% | [-48.19, -10.59] |
| Workspace, cold | 50 | 5010.80 → 4969.92 | -0.82% | [-95.01, +23.19], inconclusive |
| Workspace, warm | 50 | 3815.26 → 3712.63 | -2.69% | [-194.61, +4.22], inconclusive |

After-side empty/warm pair 0 has empty perf output; its unmatched baseline CPU value and diagnostic remain in the raw data. The CPU comparison uses 49 complete pairs, with no zero imputation or selective rerun. The other three scenarios use all 50 pairs. This run uses an Intel Xeon Platinum 8573C runner, while the preceding original-base comparison uses an AMD EPYC 7763; source comparisons and runner hardware are kept separate rather than pooled. Startup uses disabled installed extensions, and these CPU results describe that controlled configuration. No 10–20% complete-product speedup is established.

## Combined native batch and scalar-request confirmation

The next increment passes received native batches through one emitter delivery and coalesces replies to those batches. Existing 64-frame/16 Ki-character limits and binary/control FIFO flushing remain. Audited `MainThreadCommands.$executeCommand` replies use native promises because its existing async bridge always awaits them; other ordinary methods and ignored notification liveness probes retain lazy promises. Single null/string/boolean/number/undefined arguments bypass request-array JSON. Nonfinite numbers become null and negative zero becomes positive zero, matching JSON; objects, mixed buffers and other payloads retain their codecs. Legacy event listeners keep a shared current-frame wrapper and explicit disposal ownership.

Compared with scalar replies `37e23c02fb542e78dadf80a205dbada712e60406`, each topology/fixture has 54 independent paired repetitions with three labels and balanced six cyclic/reversed orders. Ordinary fixtures use 16,384 warmup and 32,768 measured calls; strings use 4,096 warmup and 8,192 measured calls, at concurrency 32. Baseline and both candidates use the same frozen Node 24.22.0 / Electron 43.7.7 foundation and harness. Core overlays match the selected implementation; this comparison precedes the production worktree's later main-merge runtime. All values, exact remote invocation counts and counter-running fractions are validated.

| Selected combined scalar-request fixture | Node user-instruction change (exploratory 95% interval) | Renderer/utility change (exploratory 95% interval) |
| --- | ---: | ---: |
| primitive | -22.15% [-22.97%, -21.68%] | -28.59% [-28.61%, -28.57%] |
| small-object | -7.32% [-7.53%, -6.91%] | -15.71% [-15.74%, -15.67%] |
| settings-100 | -0.08% [-0.18%, +0.05%] (inconclusive) | -2.45% [-2.51%, -2.37%] |
| text-4KiB | -58.98% [-59.03%, -58.90%] | -47.08% [-47.11%, -47.04%] |
| text-64KiB | -87.38% [-87.40%, -87.33%] | -56.95% [-57.06%, -56.82%] |
| text-escaped | -87.83% [-87.84%, -87.81%] | -80.02% [-80.04%, -79.99%] |

The batch/native-promise candidate without scalar requests separately changes primitive/small-object instructions by -13.10%/-7.83% in Node and -21.42%/-15.94% in renderer/utility. Scalar requests trade a small part of the small-object gain for much larger primitive/string gains. No variant, control or inconclusive result is omitted.

Separate 12-pair resolved/deferred/sequential controls retain their full values and intervals. Selected sequential primitive/small-object instructions change -8.18%/-3.10% in Node and -3.54%/-1.74% in renderer/utility. Deferred-handler gains are smaller than synchronous echo gains. These synthetic instruction results do not establish a complete-product speedup.

Fresh 12-pair binary controls (4,096 warmup, 8,192 measured calls, concurrency 32) retain the lazy mixed-buffer path. Small-buffer regressions remain visible:

| Binary fixture | Node user-instruction change (95% interval) | Renderer/utility change (95% interval) |
| --- | ---: | ---: |
| buffer-64B | +2.01% [+0.16%, +4.28%] | +0.41% [+0.31%, +0.48%] |
| buffer-512B | +2.01% [-0.43%, +3.17%] (inconclusive) | +0.36% [+0.30%, +0.48%] |
| buffer-64KiB | +3.12% [-2.23%, +16.25%] (inconclusive) | +0.15% [-0.41%, +0.52%] (inconclusive) |
| wrapped-buffer-64B | +0.54% [+0.05%, +1.28%] | +0.19% [+0.06%, +0.44%] |

All 2,880 completed process results across ordinary, strings, async/sequential and binary campaigns are retained. A user-requested migration to detached tmux interrupted Node string collection: 245 fully annotated samples were preserved, one additional incomplete attempt was archived and restarted, and remaining samples resumed with unchanged measured code/fixtures. The full 54-pair result includes every completed sample; separate pre/post-migration median points agree closely. The interrupted attempt and explicit manifest reconstruction/provenance notes are retained.

Tracked async-hook diagnostics record two fewer Promise initializations per audited observed RPC, not per notification. Profiling/instrumentation is separate from instruction collection. Regression tests cover real server-side scalar argument normalization, Unicode/NUL/long strings, object-toJSON fallback, undefined masks, cancellation, legacy listener disposal, batching and byte fallbacks. Nine scalar wire-format regressions fail before the codec change; selected validation passes 319 Node and 1,584 Electron/API/authentication tests, with three existing pending, client typechecking and targeted lint.

Full samples, all labels/metrics, rejected controls, frozen core/harness hashes and migration evidence are kept separately on the evidence branch. No 10–20% complete-product speedup is established; the current merged-base startup CPU results above remain separate.

## Combined-core packaged validation and supplementary timing

The [combined-core startup resource comparison 40251176145](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40251176145) compares `a167347ebc4ab8923c027674f602a4f74d39ada5` with `aac6b0fcf3bc6714c8cd7e7dd9fa1bfe6618ba25`, before the separate nineteen-method native-promise metadata increment. Each scenario requests fifty alternating pairs. All four task-clock intervals include zero:

| Startup scenario | Complete CPU pairs | Median CPU time before → after (ms) | Median change | Exploratory 95% paired interval for median difference (ms) |
| --- | ---: | ---: | ---: | ---: |
| Empty, cold | 49 | 3927.49 → 3917.64 | -0.25% | [-26.77, +23.01], inconclusive |
| Empty, warm | 50 | 2176.11 → 2190.14 | +0.64% | [-25.26, +37.11], inconclusive |
| Workspace, cold | 50 | 3322.35 → 3290.07 | -0.97% | [-75.19, +60.80], inconclusive |
| Workspace, warm | 50 | 2737.80 → 2748.33 | +0.38% | [-22.54, +45.97], inconclusive |

All four hundred launches have resource samples; 399 have CPU windows. Baseline empty/cold pair zero has empty perf output, and its unmatched after-side CPU measurement of 3930.181784 ms remains in the raw data. There is no zero imputation or selective rerun. The jobs use different AMD EPYC runner models (7763, 9V74, 9V45 and 9V74 respectively); each paired comparison stays within its own job. These results are not pooled with the earlier Intel or original-base AMD comparisons. Sampled PSS does not measure cumulative allocation. No 10–20% product startup improvement is established.

The [core functional comparison 40253184303](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40253184303) reuses both packages from that startup run. The [metadata functional comparison 40253420502](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40253420502) compares the same core with `264f9bc0fbf05a94c51fd0f9bc0171095b994a97`, which adds nineteen methods with twenty-three production call sites that all unconditionally await their replies. Both comparisons pass the identical sixty-two tests with sixty-eight pending and zero failures on each side. Their single paired smoke durations are compatibility evidence, not speed estimates. The metadata increment also passes 1,305 targeted API/RPC tests, with three existing pending, targeted lint and the incremental client build.

Supplementary timing uses the same fifty-four paired processes from the combined-core instruction confirmation above, without rerunning or filtering samples. Conservative 95% distribution-free order-statistic intervals for median paired log-ratios include zero for all six ordinary-fixture elapsed comparisons. They exclude zero for all six string elapsed comparisons: Node changes are -37.33%, -62.98% and -58.87% for 4 KiB, 64 KiB and escaped strings; renderer/utility changes are -15.41%, -8.71% and -46.82%. These intervals differ from the primary instruction bootstrap intervals and have no multiple-comparison correction. All six string user-plus-kernel instruction comparisons also decrease. Instructions, CPU time and elapsed time remain distinct: the renderer 64 KiB fixture reduces user instructions by 56.95%, total instructions by 30.51% and elapsed time by 8.71%.

[Exact supplementary timing and metadata audit](https://github.com/SimonSiefke/vscode/tree/17ddc353c3665a406718ee546bf712bd238c6385/performance/20261025/combined-native-timing) and [packaged startup, both functional comparisons and identical-build A/A raw data](https://github.com/SimonSiefke/vscode/tree/c2effe1a37ef2774712adc15f517914a1f231c70/performance/20261025/combined-product-validation) are archived separately. The latter archive retains all missing-window diagnostics and runtime/source identities. The completed ten-pair A/A calibration uses the exact same original package under both labels; all user and kernel instruction intervals include zero. It describes measurement noise, not an optimization gain. Cumulative actual-API and startup results use separate campaigns and are not pooled.

The numeric marshalling regression checks the BigInt value/type, NaN, both infinities and the sign of zero explicitly. The browser assertion shim uses ordinary equality for NaN and cannot JSON-format BigInt assertion failures, so directly comparing the original objects produced a browser-only test failure even when real MessagePort transport preserved every value. A reproducer using the actual browser shim fails before the assertion adjustment and passes afterward; five deliberate value-corruption cases are rejected. Production marshalling is unchanged.
