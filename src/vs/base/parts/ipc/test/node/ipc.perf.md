# IPC performance evidence

The selected implementation uses native MessagePort frames for eligible RPC traffic, scalar codecs, audited notifications and native promises for always-observed completions. Small immutable messages retain bounded batching (64 frames / 16 Ki-characters), binary/control FIFO flushing and compatibility fallbacks.

Whole-smoke duration is too noisy to select changes. Fixed-work application and isolated RPC comparisons use independent processes, balanced paired order, validated return values and exact call counts. Startup, warmup and explicit extension-host GC precede API counting. Instructions measure work, not CPU seconds; elapsed time and separately instrumented allocation profiles answer different questions.

## Current merged-core application measurements

The exact incremental package comparison is `a167347ebc4ab8923c027674f602a4f74d39ada5` → `aac6b0fcf3bc6714c8cd7e7dd9fa1bfe6618ba25`. Later native-promise metadata follow-ups and private prototypes are outside this scope. Each fixture/schedule has ten independent identical-package A/A pairs followed by fifty fixed before/after pairs. All 960 unprofiled application processes and 16 plumbing launches remain included.

The table shows paired median changes with conservative 95% sign/order-statistic intervals. Separate user/kernel bootstrap intervals and all A/A results are archived; there is no multiple-comparison correction.

| Schedule | Public API workload | User + kernel instructions | Fixed-work elapsed |
| --- | --- | ---: | ---: |
| Batch of 32 | Unchanged context | -9.22% [-9.50%, -8.87%] | -1.84% [-5.00%, +1.30%] (inconclusive) |
| Batch of 32 | Changing context | -1.76% [-1.83%, -1.69%] | -0.09% [-2.11%, +2.07%] (inconclusive) |
| Batch of 32 | 64 KiB clipboard reads | +0.11% [-0.13%, +0.20%] (inconclusive) | -0.03% [-1.33%, +1.15%] (inconclusive) |
| Batch of 32 | 64 KiB clipboard writes | -5.58% [-5.64%, -5.51%] | -1.86% [-2.89%, -0.51%] |
| Direct await, sequential | Unchanged context | -22.48% [-23.99%, -17.27%] | -2.54% [-5.74%, +1.15%] (inconclusive) |
| Direct await, sequential | Changing context | -12.09% [-12.19%, -11.93%] | -4.20% [-5.36%, -1.59%] |
| Direct await, sequential | 64 KiB clipboard reads | -0.03% [-0.36%, +0.30%] (inconclusive) | -0.68% [-3.63%, +1.32%] (inconclusive) |
| Direct await, sequential | 64 KiB clipboard writes | -3.80% [-3.91%, -3.60%] | -2.08% [-3.54%, -1.18%] |

Sequential unchanged-context samples have distinct instruction bands, also present in the noisy A/A control. The paired median differs from the ratio of separate label medians; no band is filtered and its cause is unknown. Identical binaries also produce apparent improvements of about 0.10% in user instructions and 2.89% in elapsed time in other controls. These false positives remain visible; small gains need caution.

[Complete inputs, package hashes, all controls, raw counters/logs and diagnostic profiles](https://github.com/SimonSiefke/vscode/tree/e5a85363fa79046fc6c4e641f8c341160eea5413/performance/20261025/current-core-api-confirmed).

A separate command/hover-provider pipeline uses the same `a167347e` → `aac6b0fc` packages, independent ten-pair A/A controls and fifty fixed pairs per schedule. All **240 unprofiled processes and four plumbing launches** validate returned Markdown, URI/position/token inputs and exact provider/command completion counts. Batched total instructions decrease **7.48% [-7.90%, -6.92%]**; direct-await total instructions change **-0.05% [-0.32%, +0.14%] (inconclusive)**. Both elapsed intervals and both A/A total-instruction/elapsed intervals include zero. This is completed API work, not UI hover latency. [Complete provider results and raw evidence](https://github.com/SimonSiefke/vscode/tree/dc03cbfab962ce896107da684e92cc7a697b772d/performance/20261025/provider-core-api-confirmed).

## Allocation and isolated RPC diagnostics

A separate interval-1 V8 allocation diagnostic estimates 13.54% / 10.06% fewer JavaScript bytes per primitive/small-object RPC for the selected scalar core versus its control overlay. Six fresh processes per cell complete 1,000 sequential real MessagePort RPCs after 16,384 warmup calls and GC. Both peers share one process. Sampled JavaScript bytes exclude native/external allocation and are neither exact allocation counts nor CPU estimates. [All 72 RPC and 12 count/element-width calibration profiles](https://github.com/SimonSiefke/vscode/tree/8718c9b5bcfc074842fc4e4d23f1b4600fcc0188/performance/20261025/combined-allocation-diagnostics).

The separate frozen-core 54-pair comparison versus scalar replies reduces primitive/small-object user instructions by 22.15% / 7.32% in Node and 28.59% / 15.71% across Electron renderer/utility peers. Ordinary elapsed intervals include zero. Small binary regressions remain visible, including Node 64-byte replies +2.01% and renderer 64/512-byte replies +0.41% / +0.36%. These pre-merge core overlays and packaged application comparisons have different scopes; their gains must not be multiplied. [All 2,880 processes, async/sequential/binary controls and exact sources](https://github.com/SimonSiefke/vscode/tree/a5c0342ba74ed5e2b24b97e7d3417108d4bf07f4/performance/20261025/combined-native-confirmed), [supplementary total instructions and timing](https://github.com/SimonSiefke/vscode/tree/17ddc353c3665a406718ee546bf712bd238c6385/performance/20261025/combined-native-timing).

## Startup and compatibility

The [merged-core 50-pair startup resource comparison](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40251176145) completes 400 launches with 399 CPU windows. All four paired task-clock intervals include zero. The missing baseline empty/cold window and unmatched after-side value remain recorded, without zero replacement or selective rerun. Scenarios, cache policies and hosted runner types are kept separate. Sampled PSS does not measure cumulative allocation. Startup/workload profiles are diagnostic stacks, not unprofiled performance comparisons; invalid timestamp profiles retain unweighted counts without repairing or dropping deltas.

**No 10–20% whole-product startup or smoke-suite speedup is established.** [Packaged startup, compatibility and identical-package controls](https://github.com/SimonSiefke/vscode/tree/c2effe1a37ef2774712adc15f517914a1f231c70/performance/20261025/combined-product-validation).

The [metadata-head functional pair](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40307252698) passes the same 62 tests with 68 pending and zero failures in both packages. This establishes compatibility only. Audited metadata follow-ups have no independent speedup claim. The subsequent void-returning actor type-guard fix passes client typechecking and a real MessagePort completion regression; its minified production module is byte-for-byte unchanged.

Historical compact-frame, direct-receive, scalar-reply, cumulative API and startup measurements remain on the [separate evidence branch](https://github.com/SimonSiefke/vscode/tree/perf/ipc-evidence-20261025), each with its exact source/package scope. Private candidates and rejected controls are preserved there or in the experiment workspace until reviewed; they are not selected merely because one fixture improves.

A separately tested context-notification batching candidate remains private: changing-context batch instructions improve 78.33% and elapsed improves 67.09%, but sequential changing-context instructions regress 0.85% [0.64%, 0.98%]. The small unchanged-context batch difference is comparable to its A/A fluctuation. Its separate four-scenario, 50-pair startup comparison has all 400 CPU windows, all CPU intervals include zero, and the missing PSS/unmatched value is retained. [Complete candidate comparison, controls, validation logs and original startup samples](https://github.com/SimonSiefke/vscode/tree/2c86289f01a6481bca0d49baef7a6a1df05e4a70/performance/20261025/context-composed-api-confirmed). No source change is selected from this experiment.
