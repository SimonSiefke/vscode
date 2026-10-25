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
