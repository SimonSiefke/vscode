# Early corrected-readiness full smoke pairs

Production candidate: `38b2f1066eedc6cd3395bda950ee1f7e292f9df7`. Baseline: `4df8bb183f0e984e97d8f4200c802c49061d7d3c`. Both use the identical archived harness plus the local-chat command-completion readiness correction documented in `ipc.smoke.readiness.perf.md`. No product rebuilds, changed assertions, mock responses or enabled-test changes are included.

Four pairs were dispatched before observing results, in AB/BA/BA/AB order. Each pair runs both complete suites serially on one runner; different pairs can use different hosts. Candidate/baseline roles are normalized explicitly for reversed pairs. Compare elapsed ratios within each runner rather than subtracting raw medians across hosts. Every available failure and all pending pairs remain in the accompanying JSON. The exact analysis source and verified artifact ZIP digests are included. There are no measurement retries or outlier removals.

| Pair | Order | Baseline | Candidate | Normalized change |
| --- | --- | ---: | ---: | ---: |
| [1](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39869424221) | AB | pending | pending | unavailable |
| [2](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39869428995) | BA | pending | pending | unavailable |
| [3](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39869433529) | BA | pending | pending | unavailable |
| [4](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39869438041) | AB | 501.516 s | 464.205 s | -7.44% |

Observed at 2026-10-22T23:25:06.139384+00:00. Complete matching pairs: 1 / 4.

Median within-runner candidate/baseline change: **-7.44%**. Exploratory 10,000-resample paired-ratio bootstrap interval: -7.44% to -7.44%.

This is a preliminary comparison with fewer than five pairs and remains inconclusive. A one-pair interval is degenerate and provides no confidence estimate. Every comparable full suite has exactly 62 passing tests and 68 pre-existing pending tests, identical successful inventories, and identical readiness-patch metadata/hashes. Longer corrected campaigns are separate and remain authoritative for a stronger whole-product claim. Component microbenchmarks must not be substituted for smoke results.
