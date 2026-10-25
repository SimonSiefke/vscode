# Exact-source direct receive confirmation

Compare compact frames `18f8cde2f9d038bd1fb4b868a381fea98ea1aca8` with direct native receives `ac92d647915e8434b3f9d17f957796cab32d3c03`.

Both Node worker-thread and Node-disabled Electron renderer/utility-process studies have 50 independent paired processes per fixture, balanced AB/BA order, randomized fixture order, 16,384 warmup and 32,768 measured logical calls at concurrency 32. Counting starts after warmup and GC. Returned values and exact remote executed-call counts are checked. All 600 processes pass validation, and every counter runs 100% of its measured interval.

Retired user instructions, median paired log-ratios with exploratory 95% bootstrap intervals:

| Fixture | Node change (interval) | Renderer change (interval) |
| --- | --- | --- |
| Primitive | -11.74% [-11.93%, -11.38%] | -8.88% [-8.91%, -8.85%] |
| Small object | -8.33% [-8.69%, -8.18%] | -6.71% [-6.74%, -6.66%] |
| 100-key settings | -0.25% [-0.30%, -0.17%] | -0.19% [-0.21%, -0.12%] |

The Node resolved-promise and next-task deferred-handler controls each have 12 independent pairs per fixture. Primitive/small-object changes are -12.19%/-8.69% for resolved promises and -7.13%/-5.81% for deferred handlers. Resolved settings is inconclusive; deferred settings improves 0.45%. These are separate workloads and must not be pooled with the synchronous studies.

These figures measure RPC CPU work, not elapsed latency or whole-product startup. Intervals use 10,000 deterministic paired bootstrap resamples without multiple-comparison correction. Raw counters, per-process options/runtime/module hashes, all results/logs, exact harness files and checksums are included. Browser profile caches are excluded. The harness is verified byte-identical to measurement-driver commit `1855cb5b4970`.

The source and compiled runtime overlay, preliminary studies, four-process byte-sampling diagnostics, separately instrumented constructor counts, completed smoke results and complete product-profile failures/unavailable counters are archived at commit `373ba888a572f5ccd82152c9c6b254250f89e490`, `performance/20261025/direct-receive`. Remaining frozen runtime dependencies/compiler details are at commit `1b7746ad33021ff281ff7a8ffafc7a3a00f63a8d`, `performance/20261025`. Adjust absolute runtime-map paths after extraction. Constructor-instrumented roots are never used in this confirmation.
