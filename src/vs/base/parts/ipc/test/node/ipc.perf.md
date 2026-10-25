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
