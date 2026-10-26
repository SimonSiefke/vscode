# RPC allocation diagnostics

These sampled JavaScript heap allocation diagnostics are separate from CPU, elapsed, startup and full smoke-suite measurements. Both real Node MessagePort peers run in one process. There are six independent processes per label and fixture, with exact remote execution counts and returned values checked. Every label and sample is retained.

The preferred high-resolution diagnostic samples at interval 1 after 16,384 warmup RPCs and full GC, then 1,000 measured sequential RPCs. Collected-object records are included. V8 still samples and clamps steps to tagged-word size: this is not an exact allocation census, and it excludes native/external allocations. Profiler overhead prevents treating these runs as CPU/elapsed estimates. No concurrent batching benefit is inferred.

| Fixture | Control bytes/call | Owned batch core | Core + scalar arguments | Scalar core change |
| --- | ---: | ---: | ---: | ---: |
| primitive | 2705.940 | 2405.628 | 2339.480 | -13.54% |
| small-object | 3294.556 | 2996.520 | 2963.040 | -10.06% |

These are medians of six fresh processes per cell; no confidence interval or universal performance claim is supplied. The archive also preserves the separate interval-1024 diagnostic (1,000 warmup, 10,000 measured calls). Its results are not pooled with the interval-1 results or selected to maximize the reported gain.

Calibration uses three fresh processes per case, a no-op control, doubled array count, and doubled element width. An escape ring keeps live and collected objects represented. The expected element-width delta uses the actual runtime's tagged-word size.

Observed count-doubling ratio: 1.999089857. Observed element-width delta: 2097152 bytes; expected: 2097152 bytes. Runtime is Node 24.22.0 / V8 13.6.233.17-node.57; no engine upgrade is used for the metric.

The archive contains all 72 RPC and 12 calibration raw profiles/results, their logs, metric scripts and research notes, and exact core IPC/event/buffer module bytes/hashes. It is a diagnostic evidence bundle, not a standalone VS Code build. Source and compiled core identities are distinct from the current merged-base packaged application campaigns. Observed-promise metadata is enabled identically across labels.

Archive SHA-256: `64f53d69c85481dd78ed6b99d8e5de0df3a04713d10bdc589fe318d2edac217d`.
