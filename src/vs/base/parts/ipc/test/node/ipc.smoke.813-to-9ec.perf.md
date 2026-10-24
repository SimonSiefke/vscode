# Direct archived-package compaction control

Campaign: https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39844477747

Compare `813b4e289c443861eab15f13352bbc44a6fd0fed` directly against `9ec9dde1b2d141b3ab2ee327edc9c15e1ea17348`, reusing their original minified packages. Six alternating AB/BA pairs execute on one runner, using the same compiled `4df8bb183f0e984e97d8f4200c802c49061d7d3c` harness and `ecb012634f104f7a8188d9e3610a4d2d65bef6f6` fixture. No rebuild, assertion changes, retries or outlier removal.

All twelve suites pass all 62 cases, with the same 68 pending cases. Baseline median is 533.510 s; candidate median is 532.296 s: **−0.23%, inconclusive**. The paired interval is [−18.079 s, +1.332 s]. All six complete pairs are retained in the accompanying result JSON; full stdout and diagnostics remain in the digest-verified Actions artifact.

The earlier `9ec` versus upstream campaign showed a +3.75% regression, including repeated 15-second automation pauses. This direct control does **not** reproduce a statistically established slowdown from the two compaction/array changes. Nor does it establish a useful whole-suite gain. Different-host campaigns cannot be subtracted to attribute a particular change. The features remain held because they failed to demonstrate a smoke benefit and their local controls include regressions.

This comparison predates common-channel batching, so it neither validates nor rejects that later feature. The 10–20% smoke target is not demonstrated.
