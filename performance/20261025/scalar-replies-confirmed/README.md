# Exact-source scalar reply confirmation

Compare direct native receives `ac92d647915e8434b3f9d17f957796cab32d3c03` with scalar replies `37e23c02fb542e78dadf80a205dbada712e60406`. Native null/string/boolean/number replies skip JSON; undefined retains the empty reply. Nonfinite numbers normalize to null and negative zero to positive zero, preserving JSON behavior. Objects, buffers, errors and cancellation retain their prior codecs.

Each topology/fixture has fifty independent paired processes, balanced AB/BA variant order and randomized fixture order. Ordinary fixtures use 16,384 warmup and 32,768 measured calls; string fixtures use 4,096 warmup and 8,192 measured calls. Concurrency is 32. Both peers collect garbage before counting. All 1,200 processes validate values and the exact remote executed-call count. All hardware counters run 100% of their measured window. No CPU profiler is active. Node uses version 24.22.0 and the product 8 KiB Buffer pool. Renderer/utility uses Electron 43.7.7, Node 24.21.0, and no Buffer in the renderer. These are separate topologies; their observations are not pooled.

Primary retired user instructions, median paired log-ratios with exploratory 95% bootstrap intervals:

| Fixture | Node change (interval) | Renderer/utility change (interval) |
| --- | ---: | ---: |
| primitive | -4.188% [-4.532%, -3.730%] | -4.772% [-4.810%, -4.722%] |
| small-object | +0.095% [-1.268%, +0.334%] (inconclusive) | -0.038% [-0.056%, -0.002%] |
| settings-100 | +0.067% [+0.009%, +0.157%] | -0.028% [-0.093%, +0.031%] (inconclusive) |
| text-4KiB | -33.219% [-33.292%, -33.162%] | -18.060% [-18.117%, -17.999%] |
| text-64KiB | -46.430% [-46.493%, -46.306%] | -36.823% [-36.992%, -36.660%] |
| text-escaped | -45.715% [-45.730%, -45.700%] | -41.134% [-41.291%, -41.060%] |

The small Node settings regression (+0.067%, interval [+0.009%, +0.157%]) is retained rather than omitted. Node small-object and renderer settings results are inconclusive; renderer small-object change is negligible.

## Supplementary elapsed and process CPU time

These use the same unprofiled runs and fifty paired process comparisons. String elapsed-time intervals exclude zero in both topologies. Ordinary-fixture elapsed intervals include zero. They measure these fixed RPC workloads, not whole-product startup or smoke-test duration.

| String fixture | Node elapsed change (95% interval) | Renderer/utility elapsed change (95% interval) |
| --- | ---: | ---: |
| text-4KiB | -24.57% [-27.41%, -19.26%] | -9.66% [-13.13%, -6.29%] |
| text-64KiB | -29.52% [-31.16%, -28.22%] | -9.54% [-10.30%, -8.20%] |
| text-escaped | -30.73% [-39.05%, -24.33%] | -26.39% [-29.89%, -24.21%] |

Whole-Node-process user plus system CPU time changes -24.38% for 4 KiB, -33.26% for 64 KiB and -32.15% for escaped text; all three intervals exclude zero. Primitive CPU time changes -4.93%, but primitive elapsed time is inconclusive. Kernel counters are reported separately: Node 64 KiB kernel instructions increase 15.19% [12.75%, 24.01%], while summed user plus kernel instructions fall 43.63% [-43.73%, -43.55%]. CPU instructions, CPU time and elapsed time are distinct quantities. Full supplementary tables, individual samples and summary scripts are included.

All intervals use 10,000 deterministic paired bootstrap resamples without multiple-comparison correction. The exact harness is byte-verified against driver commit `1855cb5b4970`. Source/compiled core overlays and hashes, runtime maps, process logs, raw perf CSV and all result files are included. The matching Electron binary was preserved before refreshing the implementation worktree to Electron 43.8.3; the preservation hash and runtime-link manifest are included. Compiled baseline overlays are in earlier direct-receive evidence; remaining foundation/compiler details are in the immutable initial archive at `1b7746ad33021ff281ff7a8ffafc7a3a00f63a8d`, `performance/20261025`. Adjust local runtime-map and Electron paths when reproducing. Browser profile caches are excluded.

## Compatibility and product controls

Scalar smoke run `40227240697` passes the same 62 tests with 68 pending in both versions. This is one compatibility pair; its elapsed duration is not a performance estimate. Exact test lists, statuses, durations and logs are retained.

Scalar startup run `40221936330` completes all 400 launches (fifty pairs per cold/warm empty/workspace scenario); all four timing intervals include zero. Those complete startup samples are archived at `e26ec2dd748c4df3e810fd274e8eeb2e290ea3be`, `performance/20261025/product-confirmation`.

A hosted-runner software-counter availability probe, run `40230499876`, reuses the same packages and completes twenty successful warm-workspace launches with no partial samples or diagnostics. Process-tree task-clock, faults/context switches and sampled PSS are available even though prior hosted hardware-instruction probes were unavailable. Its ten-pair task-clock change +1.41% has interval [-56.49, +135.07] ms and is inconclusive. It validates this alternative measurement path, not a speedup. Raw counters/application logs and all metric summaries are included. PSS peaks are sampled every 250 ms and can miss brief peaks; PSS is not allocation volume.

These source comparisons precede the later merge from main and the ten-method notification increment. Source `37e23c02fb542e78dadf80a205dbada712e60406` passes 297 Node and 1,544 Electron/API/authentication tests (three existing pending), typechecking, lint and hygiene. The later merged-base source separately passes 297/1,562 with three existing pending. No 10–20% whole-product speedup is established.
