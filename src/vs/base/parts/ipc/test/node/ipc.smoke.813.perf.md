# Full enabled smoke suite: 813 paired comparison (2026-10-22)

[GitHub Actions run 39813655644](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39813655644) compares unchanged baseline `4df8bb183f0e984e97d8f4200c802c49061d7d3c` with `813b4e289c443861eab15f13352bbc44a6fd0fed`. This candidate adds inactive-role body filtering to the hybrid channel serializer, native extension RPC, short acknowledgements/batching, buffer-reference parser and shared-frame decode fix. It predates compact native buffers, primitive-array encoding, common-channel batching, the byte cursor/cache optimization and RPC timer reuse.

Median complete process wall time is 559.716 → 545.393 seconds, a 2.56% decrease. The exploratory 95% paired-bootstrap interval for the difference is -20.372 to -12.043 seconds; it excludes zero. Every candidate suite is faster than its paired baseline. **This is measurable improvement in this campaign, but does not meet the requested 10–20% target.**

Eight AB/BA pairs run sequentially on the same runner (`runnervm8k3b6`, Node v24.15.0), using archived minified packages and an identical compiled smoke harness and fixture `ecb012634f104f7a8188d9e3610a4d2d65bef6f6`. Every one of the 16 suites succeeds with exactly the same 62 passing and 68 pre-existing pending tests. Stable-version migration cases and existing pending cases are unchanged on both sides. No measurement retries, outlier removal, assertion changes or failed-attempt exclusion are used.

| Pair | Order | Baseline seconds | Candidate seconds |
| --- | --- | ---: | ---: |
| 1 | before / after | 581.678 | 545.210 |
| 2 | after / before | 555.825 | 532.572 |
| 3 | before / after | 560.014 | 547.971 |
| 4 | after / before | 566.023 | 545.651 |
| 5 | before / after | 558.154 | 542.763 |
| 6 | after / before | 547.511 | 538.402 |
| 7 | before / after | 559.419 | 545.576 |
| 8 | after / before | 560.609 | 553.366 |

The interval uses 10,000 deterministic paired bootstrap resamples of the difference between the two medians. This is one runner and one campaign, with limited precision and no multiple-comparison significance claim. The adjacent raw file includes every inventory, sample, summary and the per-test diagnostic script. The checksummed Actions artifact retains all logs.

Mocha’s rounded case durations suggest approximately 377 seconds baseline / 370 seconds candidate in test cases, with approximately 182 / 175 seconds outside case bodies (medians of per-suite sums and differences). Very short cases omit their duration, so these decompositions are approximate. No individual-test causal speedup is claimed.

The earlier b655 campaign was inconclusive (−0.50%). Its baseline ran in 488.4 seconds on a different runner, while this baseline ran in 559.7 seconds. Do not subtract medians across campaigns or attribute the difference between the two percentage changes solely to role filtering. The paired within-campaign comparisons are the relevant evidence.

Later candidate comparisons continue independently. Full-suite results are distinct from local transport microbenchmarks.
