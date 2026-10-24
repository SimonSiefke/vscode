# Full enabled smoke suite: compact-buffer/array candidate (2026-10-22)

[GitHub Actions run 39819828349](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39819828349) compares unchanged baseline `4df8bb183f0e984e97d8f4200c802c49061d7d3c` with `9ec9dde1b2d141b3ab2ee327edc9c15e1ea17348`. The latter includes compact native buffers and bulk primitive-array encoding in addition to the earlier cumulative IPC/RPC changes. It predates common-channel batching, the byte cursor/cache optimization, timer reuse and explicit notifications.

**This campaign regresses:** median complete process wall time is 457.781 → 474.963 seconds, +3.75%. The exploratory 95% paired-bootstrap interval for the difference is +1.185 to +23.893 seconds. These full-suite results take precedence over favorable local serialization microbenchmarks. The requested 10–20% improvement remains unmet.

Eight AB/BA pairs run sequentially on the same runner (`runnervm8k3b6`, Node v24.15.0), using archived minified packages and an identical compiled smoke harness and fixture. All 16 suites succeed with the same 62 passing and 68 pre-existing pending tests. No measurement retries, outlier removal, assertion changes or failed-attempt exclusions occur.

| Pair | Order | Baseline seconds | Candidate seconds |
| --- | --- | ---: | ---: |
| 1 | before / after | 476.485 | 459.995 |
| 2 | after / before | 451.359 | 439.510 |
| 3 | before / after | 458.684 | 471.957 |
| 4 | after / before | 463.762 | 478.120 |
| 5 | before / after | 449.557 | 477.969 |
| 6 | after / before | 456.793 | 483.285 |
| 7 | before / after | 456.878 | 479.376 |
| 8 | after / before | 463.223 | 469.899 |

The interval uses 10,000 deterministic paired bootstrap resamples of the difference between medians. This is an exploratory single campaign, without a multiple-comparison significance claim. Do not subtract raw medians from the earlier campaigns on different runners or attribute the cumulative change to one optimization without an incremental comparison.

Per-test diagnostics concentrate much of the mean regression in `Agents Window (local AgentHost) Test Copilot CLI session via AgentHost`: five of eight candidate attempts take approximately 22 seconds, while all baseline attempts take approximately 5.5–5.8 seconds. The other three candidate attempts take approximately 5.4–5.7 seconds. A selected slow trace shows approximately 17 seconds between chat creation and turn dispatch, compared with under one second in the paired baseline. The cause of this delay has not been established; these slow attempts remain included.

Rounded Mocha case totals have medians of approximately 320 seconds baseline / 338 seconds candidate, while time outside case bodies is approximately 140 / 136 seconds. These decompositions are approximate because short case durations are omitted. Full inventories, all samples and per-test diagnostics are in `ipc.smoke.9ec.results.json`; the checksummed Actions artifact retains all logs.
