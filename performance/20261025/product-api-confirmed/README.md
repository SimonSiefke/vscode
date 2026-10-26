# Completed packaged public-API CPU measurements

These Linux process-tree hardware counters measure fixed completed VS Code public-API work in actual packaged applications. Startup, five-second settling, warmup and extension-host forced GC are outside the counter window. Per-call completion/value assertions are inside the measured fixture; result-file writing and final counter validation are outside it. The original-package cumulative comparison is microsoft/vscode@4df8bb183f0e984e97d8f4200c802c49061d7d3c → SimonSiefke/vscode@37e23c02fb542e78dadf80a205dbada712e60406. It precedes the later main merge, combined native core AAC and nineteen-method metadata264. This dataset does not measure those later increments.

Each candidate fixture has fifty fixed alternating independent pairs. Independent identical-build A/A campaigns have ten pairs per fixture. All 480 unprofiled processes validate completed calls, values and user/kernel hardware-counter running fractions of at least 99%. No outliers, failed windows or labels are selectively replaced. Exact source, executable/archive hashes, runtime versions, harness arguments and file checksums are retained.

User and kernel instruction intervals are exploratory paired bootstrap intervals from the original collector. Supplementary total-instruction and elapsed intervals are conservative 95% order-statistic intervals for median paired log-ratios from the same completed samples. There is no multiple-comparison correction. Instructions, CPU time and elapsed time are distinct; none is a full smoke-suite or startup speedup.

## Original-package cumulative comparison

| Fixture | User instructions | Kernel instructions | User + kernel instructions | Fixed-work elapsed |
| --- | ---: | ---: | ---: | ---: |
| context-unchanged | -83.54% [-83.83%, -83.36%] | -96.02% [-96.05%, -95.97%] | -86.05% [-86.27%, -85.94%] | -83.71% [-84.14%, -83.29%] |
| context-changing | -50.76% [-51.53%, -50.66%] | -95.24% [-95.28%, -95.20%] | -56.44% [-56.94%, -56.24%] | -62.46% [-63.37%, -62.05%] |
| clipboard-64KiB | -64.37% [-64.47%, -64.27%] | -50.64% [-50.79%, -50.50%] | -61.20% [-61.27%, -61.11%] | -43.05% [-43.33%, -42.58%] |

These fixtures perform 32768 measured public-API calls after 16384 warmup calls, at concurrency 32. Set-context fixtures await every command completion; clipboard reads validate each returned 64 KiB string. Counters include all inherited application processes/threads, not just RPC code.

## Scalar clipboard increment

This separate ac92→37e package comparison isolates the earlier scalar-reply increment; full source IDs and executable hashes are in the manifest. It uses 8192 measured clipboard reads after 4096 warmup, concurrency 32.

| Fixture | User instructions | Kernel instructions | User + kernel instructions | Fixed-work elapsed |
| --- | ---: | ---: | ---: | ---: |
| clipboard-64KiB | -21.30% [-21.36%, -21.24%] | -0.43% [-0.79%, -0.16%] | -16.12% [-16.25%, -16.00%] | -6.27% [-7.40%, -5.02%] |

## Identical-build A/A controls

Both A/A labels use the exact same package within each campaign. These are measurement-noise controls, not optimization results.

### Original-package A/A

| Fixture | User instructions | Kernel instructions | User + kernel instructions | Fixed-work elapsed |
| --- | ---: | ---: | ---: | ---: |
| context-unchanged | +1.23% [-3.68%, +3.49%] (inconclusive) | +0.03% [-1.26%, +1.68%] (inconclusive) | +0.99% [-5.32%, +3.41%] (inconclusive) | +1.08% [-8.03%, +12.14%] (inconclusive) |
| context-changing | +0.94% [-0.58%, +5.33%] (inconclusive) | +0.49% [-2.22%, +2.18%] (inconclusive) | +0.81% [-1.14%, +8.28%] (inconclusive) | -1.45% [-3.91%, +4.84%] (inconclusive) |
| clipboard-64KiB | +0.26% [-0.66%, +1.53%] (inconclusive) | -0.06% [-0.85%, +0.47%] (inconclusive) | +0.13% [-0.95%, +1.28%] (inconclusive) | +0.10% [-2.27%, +1.48%] (inconclusive) |

### Scalar-baseline A/A

| Fixture | User instructions | Kernel instructions | User + kernel instructions | Fixed-work elapsed |
| --- | ---: | ---: | ---: | ---: |
| clipboard-64KiB | -0.18% [-0.39%, -0.10%] | -0.08% [-1.98%, +0.26%] (inconclusive) | -0.22% [-1.22%, +0.21%] (inconclusive) | +0.28% [-2.53%, +2.91%] (inconclusive) |

The scalar-baseline identical-build A/A user-instruction comparison shows a small -0.177% separation (95% bootstrap interval [-0.391%, -0.095%]) despite identical executable and fixture hashes. Its kernel, total-instruction and elapsed intervals include zero. This is a retained measurement effect, not a real optimization, and warns against claims at a few tenths of a percent without further independent confirmation. No sample is filtered or replaced to remove it.

## Separate diagnostic profiles

Twelve extension-host CPU profiles capture two independent repetitions per label/fixture only after every unprofiled campaign. They are excluded from all hardware/elapsed performance estimates. This diagnostic covers the extension host, not the renderer, main process or kernel. The summary exposes idle and instrumentation-wrapper self weights (which may include native work and are not subtracted), long sampling gaps, and named IPC ancestry; absent recognizable frames do not mean absent IPC work. Sample weights are not CPU accounting, and inclusive frames overlap. Native code, inlining and asynchronous continuations limit name-based attribution. Raw profiles remain available for inspection.

The harness is versioned at [cc3acc57](https://github.com/SimonSiefke/vscode-memory-leak-finder/tree/cc3acc57df8d6bd1bee9fd0093024ffdea90d130/scripts/ipc-benchmark). The archive includes every completed result/counter/process log, command/runtime manifests, all labels, supplementary analysis source and all twelve raw diagnostic profiles. It excludes private Chromium caches and application binaries, which are identified by exact build/archive hashes. No new pull request is created for this evidence.

Archive SHA-256: `913f9c5396972ad8473a46539f5d211bd4b858ee5309cfd2accaa73853a1d37b`.
