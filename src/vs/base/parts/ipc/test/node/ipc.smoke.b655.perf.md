# Full enabled smoke suite: first valid paired comparison (2026-10-22)

[GitHub Actions run 39809024414](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39809024414) compares unchanged baseline `4df8bb183f0e984e97d8f4200c802c49061d7d3c` with `b65533addf8a3b794b109e89ebed2030f27218a1`. The latter includes the hybrid channel serializer, native extension RPC, short acknowledgements/batching, buffer-reference parser and shared-frame decode fix. It predates inactive-role filtering, compact native buffers, primitive-array encoding, common-channel batching and the byte cursor/cache optimization.

**This comparison does not demonstrate the requested 10–20% full smoke improvement.** Median complete process wall time is 488.441 → 486.018 seconds, a 0.50% decrease. The exploratory 95% paired-bootstrap interval for the difference is −14.815 to +13.027 seconds and crosses zero.

Eight AB/BA pairs run sequentially on the same runner (`runnervmfese6`, Node v24.15.0), using archived minified packages and an identical compiled smoke harness and fixture `ecb012634f104f7a8188d9e3610a4d2d65bef6f6`. Every one of the 16 suites succeeds with exactly the same 62 passing and 68 pre-existing pending tests. Stable-version migration cases and existing pending cases are unchanged on both sides. No measurement retries, outlier removal, assertion changes or failed-attempt exclusion are used.

| Pair | Order | Baseline seconds | Candidate seconds |
| --- | --- | ---: | ---: |
| 1 | before / after | 533.591 | 486.277 |
| 2 | after / before | 498.542 | 487.183 |
| 3 | before / after | 458.187 | 481.826 |
| 4 | after / before | 479.845 | 485.759 |
| 5 | before / after | 482.340 | 502.093 |
| 6 | after / before | 495.424 | 509.329 |
| 7 | before / after | 494.542 | 471.049 |
| 8 | after / before | 475.525 | 479.727 |

The interval uses 10,000 deterministic paired bootstrap resamples of the difference between the two medians. Eight pairs provide limited precision; this is one runner and one campaign, without a multiple-comparison significance claim. The adjacent raw file includes every inventory, sample, summary and the per-test diagnostic script. The checksummed Actions artifact retains all logs.

Mocha’s rounded case durations suggest approximately 331 seconds baseline / 335 seconds candidate in test cases, with approximately 156 / 150 seconds outside case bodies (medians of per-suite sums and differences). Very short cases omit their duration, so these decompositions are approximate. Container, SSH, chat and repeated-restart cases occupy substantial time; their labels and durations alone do not establish which subsystem caused the timing changes. No individual-test speedup is claimed from this campaign.

The later four candidate comparisons continue independently. These are full-suite results, distinct from local transport microbenchmarks.
