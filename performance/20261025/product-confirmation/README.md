# Packaged application API and startup confirmation

The actual packaged application compares compact frames `18f8cde2f9d038bd1fb4b868a381fea98ea1aca8` with direct native receives `ac92d647915e8434b3f9d17f957796cab32d3c03`. Fifty independent balanced pairs per fixture each execute 16,384 warmup and 32,768 validated extension API calls at concurrency 32, following a five-second settling period. All 200 processes validate the logical call count and returned values. Hardware counters run 100% of the measured intervals. Application processes and inherited threads are included; startup, warmup and Xvfb are excluded. Only the extension host explicitly collects garbage before measuring, so normal background/UI work remains included.

| Actual API workload | Median paired user-instruction change | Exploratory 95% paired interval |
| --- | ---: | ---: |
| `setContext`, unchanged value | -1.9639% | [-2.0795%, -1.8713%] |
| `setContext`, alternating value | -0.3822% | [-0.4260%, -0.3389%] |

The independent identical-package A/A calibration has ten pairs: unchanged-context user instructions change -0.0160%, interval [-0.2811%, +0.6833%], including zero. No owned application descendants remain after the completed A/A cases. These are completed public API operations with real handlers, distinct from isolated RPC benchmarks and whole-smoke duration. The changing workload performs more UI work, reducing the fraction attributable to RPC. Kernel-instruction intervals include zero. Paired log-ratio intervals use 10,000 bootstrap resamples without multiple-comparison correction.

The raw result files include exact commits, archive and executable hashes, fixture hash, runtime information, counter scope and options. Exact harness files are byte-verified against measurement-driver commit `1855cb5b4970`. Profile caches are excluded; application logs and all measured results remain. Adjust executable paths in `products-raw.json` when reproducing with the matching CI packages.

## Startup and compatibility controls

Run `40215506758` compares the same direct-receive pair with fifty pairs in each of four startup scenarios: all 400 launches succeed. Median changes are -1.15% empty/cold, -0.10% empty/warm, +2.28% workspace/cold and -0.97% workspace/warm. All four exploratory paired median-difference intervals include zero. No startup speedup is established. All samples, including the first large cold launch, are retained; means, medians, extrema and intervals are in `raw-startup50-summary.json`.

Run `40217494355` passes the same 62 smoke tests with 68 pending in each version. It is one compatibility pair and is not a performance estimate. The exact matching test list, statuses and raw durations are retained.

Run `40221936330` separately compares direct receives `ac92d647915e8434b3f9d17f957796cab32d3c03` with scalar replies `37e23c02fb542e78dadf80a205dbada712e60406`, also 400 successful launches. Median changes are +0.12%, +0.61%, -0.74% and +0.51% in the same scenario order. All four intervals include zero. These are separate increments and are not pooled. Official `Statistics.ts` paired bootstrap summaries and the scripts invoking them are included. Fixed API/CPU measurements for scalar replies are not part of this artifact.

These source comparisons precede the later merge from main; changing base revisions must not be attributed to these isolated increments. No 10–20% whole-product improvement has been established.
