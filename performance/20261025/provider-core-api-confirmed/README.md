# Current-core command/provider API comparison

This is the separate exact packaged a167→AAC command/hover-provider pipeline comparison. These are completed public API requests with real renderer/extension-host handlers, not UI hover latency or whole-product startup. Later metadata and private batching prototypes are outside this source comparison.

Each schedule has an independent ten-pair identical-package A/A control followed by fifty fixed before/after pairs. All 240 unprofiled and 4 plumbing application launches are retained. Fixed counts, returned Markdown/URI/position/token values, exact provider/command counts, archive identities and counter running coverage are verified. Startup, warmup and extension-host GC precede measurement. No outliers, failed-window replacement, early stopping or schedule pooling.

Instructions measure work, not CPU seconds; elapsed time is supplementary. Tables show paired median percentage changes and 95% intervals. User/kernel intervals are the original exploratory bootstrap; total/elapsed intervals use conservative sign/order statistics. No multiple-comparison correction. All A/A false positives and inconclusive results remain visible. This evidence establishes no 10–20% startup/full-smoke improvement.

## Fixed fifty-pair comparisons

| Schedule | Fixture | User instructions | Kernel instructions | Total instructions | Elapsed |
| --- | --- | --- | --- | --- | --- |
| batch32 | hover-provider | -6.456% [-6.819, -5.829] | -23.161% [-24.056, -21.728] | -7.480% [-7.901, -6.922] | -0.874% [-3.474, +2.468] (inconclusive) |
| direct await1 | hover-provider | -0.227% [-0.338, +0.038] (inconclusive) | +0.080% [-0.290, +0.570] (inconclusive) | -0.052% [-0.321, +0.138] (inconclusive) | -1.105% [-2.271, +1.184] (inconclusive) |

## Identical-package A/A controls

| Schedule | Fixture | User instructions | Kernel instructions | Total instructions | Elapsed |
| --- | --- | --- | --- | --- | --- |
| batch32 | hover-provider | +0.609% [-0.783, +1.804] (inconclusive) | -2.206% [-9.928, +0.683] (inconclusive) | +0.224% [-1.719, +2.667] (inconclusive) | +2.399% [-20.515, +8.285] (inconclusive) |
| direct await1 | hover-provider | -0.159% [-0.334, +1.575] (inconclusive) | +0.357% [-0.283, +0.921] (inconclusive) | +0.239% [-0.199, +2.760] (inconclusive) | +0.878% [-2.816, +1.410] (inconclusive) |

Only the original queue parent was held after all 100 measured children of the batched fifty-pair phase completed normally. The sequential A/A and fifty-pair stages resumed unchanged. No measured child was signalled, paused or repeated. Journals and source-work release are archived. The archive includes every raw result, counter CSV and process/controller log, summaries, fixture/collector source and package metadata. Named Chromium caches are not measurement evidence and are excluded.

Archive SHA-256: `1ce1cead1487a7a518b27ed5903af75cd5803ee58577851f0c42a9a356c2e9cd`.
