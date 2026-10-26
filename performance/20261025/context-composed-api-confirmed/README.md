# Composed context batching comparison

The exact packaged comparison is actual `7716e776bee27bcd81a8eb5908d0eb7ee8726ad4` to private candidate `a498c2e0970c303bb4fb0469eeb40b5c1970173a`. The candidate preserves the selected MessagePort scalar codecs, bounded small-message batching and native promises, and coalesces synchronous context-key notifications within physical native RPC packets. Current parent `0f00a7e3` differs from the actual baseline by a type/test correction with byte-identical minified production metadata; the baseline package is not relabelled.

Both unchanged/changing public context-command fixtures run ten independent identical-package A/A pairs followed by fifty fixed before/after pairs per schedule (batch32 and direct await1). All480 unprofiled and8 plumbing launches are retained. Fixed counts, returned results, package hashes, positive counters and running coverage are verified. Startup, warmup and extension-host GC precede each API counting window. No sample exclusions, early stopping, schedule pooling or automatic source selection.

Instructions measure work, not CPU time. Elapsed time is supplementary. Tables show paired median percentage changes and95% intervals. User/kernel intervals are exploratory bootstrap; total/elapsed intervals use conservative sign/order statistics. No multiple-comparison correction. All A/A false positives and inconclusive results remain visible. A small unchanged-context effect comparable to its A/A fluctuation is not attributed to this candidate. This comparison does not establish10–20% whole-product startup or smoke-suite improvements.

## Fixed fifty-pair comparisons

| Schedule | Fixture | User instructions | Kernel instructions | Total instructions | Elapsed |
| --- | --- | --- | --- | --- | --- |
| batch32 | context-unchanged | -0.826% [-5.445, +0.045] (inconclusive) | -2.330% [-2.898, -0.485] | -0.643% [-5.227, -0.112] | -2.848% [-6.314, +1.217] (inconclusive) |
| batch32 | context-changing | -78.907% [-78.948, -78.808] | -41.547% [-42.651, -40.504] | -78.332% [-78.396, -78.212] | -67.092% [-68.463, -66.367] |
| direct await1 | context-unchanged | +1.139% [+0.125, +2.340] | +0.588% [-0.254, +2.048] (inconclusive) | +1.071% [-0.692, +2.445] (inconclusive) | +1.457% [-0.131, +4.632] (inconclusive) |
| direct await1 | context-changing | +0.798% [+0.689, +0.959] | +0.707% [+0.113, +1.586] | +0.847% [+0.635, +0.978] | +1.124% [-0.601, +4.726] (inconclusive) |

## Identical-package A/A controls

| Schedule | Fixture | User instructions | Kernel instructions | Total instructions | Elapsed |
| --- | --- | --- | --- | --- | --- |
| batch32 | context-unchanged | -0.626% [-4.923, -0.177] | -2.433% [-4.921, +4.151] (inconclusive) | -0.749% [-4.527, +0.076] (inconclusive) | +7.877% [-2.955, +46.804] (inconclusive) |
| batch32 | context-changing | -0.069% [-0.271, +0.240] (inconclusive) | -2.353% [-3.386, +4.049] (inconclusive) | -0.054% [-0.481, +0.433] (inconclusive) | -3.203% [-7.682, +14.604] (inconclusive) |
| direct await1 | context-unchanged | -0.821% [-27.231, +14.298] (inconclusive) | -1.990% [-3.416, +2.148] (inconclusive) | -1.626% [-23.932, +24.210] (inconclusive) | -1.283% [-10.841, +8.296] (inconclusive) |
| direct await1 | context-changing | +0.048% [-0.061, +0.353] (inconclusive) | +0.153% [-0.372, +0.833] (inconclusive) | +0.109% [-0.100, +0.373] (inconclusive) | +0.260% [-4.614, +6.001] (inconclusive) |

The composed candidate remains private: the large changing-context batch win accompanies a repeated sequential changing-context instruction regression of +0.847% [+0.635%, +0.978%]. Sequential elapsed is inconclusive. A later minimum-batch-size refinement must receive separate tests and independent package measurements. No production source selection is made by this archive.

## Separate startup resource comparison

[Original workflow run](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/40376152386) reuses the same exact package builds. Four scenarios each have50 pairs,400 original CPU windows in total. All raw metrics and the missing baseline empty/cold PSS sample with its unmatched after value remain preserved. PSS is resident memory rather than cumulative allocation. Different scenarios, cache policies and hosted runner types are kept separate. These intervals are paired bootstrap median CPU-time differences in milliseconds, distinct from the API instruction/elapsed intervals above.

| Scenario | Before CPU ms | After CPU ms | Median change | Paired95% interval ms |
| --- | ---: | ---: | ---: | --- |
| startup-empty-cold-resources | 3218.689646 | 3237.819825 | 0.5943468027050728% | [-32.43560350000007, 54.89379649999955] |
| startup-empty-warm-resources | 2233.8681955 | 2216.462052 | -0.7791929503747806% | [-42.01944649999996, 22.14227000000028] |
| startup-workspace-cold-resources | 4738.512807 | 4712.070959 | -0.5580199754011215% | [-170.41660599999977, 123.7282995000005] |
| startup-workspace-warm-resources | 2710.965169 | 2737.0353219999997 | 0.9616557710926334% | [-26.510163999999804, 64.59515799999963] |

All fixed campaigns completed before the bounded counterfree source/evidence review. No measured child was signalled, paused or repeated. The archive includes every raw API result, counter CSV, process/controller log, fixture and collector source, package provenance, startup result bundle and partial metric. Named Chromium caches are excluded.

Archive SHA-256: `8c88a7b0e91431de676e01cc202271ae38d75102d3cacf7ebdf5f1116bc877b6`.
