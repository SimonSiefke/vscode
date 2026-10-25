# IPC performance evidence

Raw historical benchmark samples, source snapshots, held experiments and smoke diagnostics are preserved on [the evidence branch](https://github.com/SimonSiefke/vscode/tree/perf/ipc-evidence-20261025), frozen at `cfe956a300ea61706f2969835de2c886a75474a2`. They are excluded from this implementation diff.

The strongest completed corrected-harness comparison for production commit `38b2f1066eedc6cd3395bda950ee1f7e292f9df7` measured a 1.98% lower full-smoke median over eight paired comparisons against upstream `4df8bb183f0e984e97d8f4200c802c49061d7d3c`. Whole-smoke duration is noisy and is supporting evidence, not the optimization acceptance criterion. No 10–20% whole-product improvement has been established.

Further measurements use actual MessagePort transports with the Linux product buffer pool, fixed payloads, deterministic returned-value and message-count checks, randomized paired order, warmup, and fresh-process replication. Latency/throughput and CPU cost are measured without profiling; allocation sampling and CPU profiles run separately. Startup comparisons use at least 50 paired samples, report dispersion and paired confidence intervals, and keep fixture, cache policy and readiness boundaries equal. Cold and warm startup remain separate.

Small-message batching, FIFO delivery, binary/control flushing and cancellation remain covered by regression tests. Changes are selected only after ordinary and mixed-message controls are measured alongside the targeted workload.

The additional audited notifications cover filesystem watcher registration/disposal, terminal environment updates, tool registration/progress and chat status. An actual watcher lifecycle over real RPC peers reduces ignored empty replies from two to zero while preserving watch-before-unwatch ordering. SCM updates retain completion replies because callers release old command resources in `finally` callbacks. Combined transport/API/authentication validation: 1,496 passing, three pre-existing pending.
