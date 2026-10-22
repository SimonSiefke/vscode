# Complete follow-up campaign outcomes

All comparisons use alternating AB/BA pairs on one runner, identical archived upstream harness and fixture, with every failed attempt retained. These experiments do not establish the requested 10–20% whole-suite gain.

| Campaign | Baseline complete | Candidate complete | Matched complete pairs | Survivor change |
| --- | ---: | ---: | ---: | ---: |
| [timer](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39839075338) | 8 / 8 | 1 / 8 | 1 | -2.68% |
| [notif10](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39844353320) | 6 / 6 | 2 / 6 | 2 | -3.34% |
| [no-compact](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39847409403) | 6 / 6 | 2 / 6 | 2 | +1.25% |
| [direct-no-batch](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39861391952) | 1 / 2 | 2 / 2 | 1 | -0.20% |
| [expanded notifications](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39848802467) | 6 / 6 | 0 / 6 | 0 | unavailable |
| [optional arguments/chat](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39855860391) | 4 / 4 | 1 / 4 | 1 | -1.99% |
| [no common-channel batching](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39858849225) | 4 / 4 | 4 / 4 | 4 | -2.51% |

All comparisons above are labelled inconclusive by the harness. Except for the complete four-pair no-common-channel-batching campaign, fewer than three pairs complete. Survivor estimates are not reliable general performance results for failing candidates. The degenerate one-pair intervals in raw harness output provide no useful confidence estimate. Baseline and candidate failures remain in the raw reports; there are no measurement retries or outlier removals.

The complete no-common-channel-batching campaign measures baseline median 550.921 s and candidate median 537.089 s, a 2.51% reduction. All eight suites pass 62 tests with 68 pre-existing pending tests. Every paired candidate is faster, with elapsed differences ranging from -38.666 to -1.980 s. The four-pair report still labels the comparison inconclusive because it requires at least five pairs; it does not establish the requested 10–20% target. This is revision `5f2`, before the latest ACK optimization, and uses the original harness. Keep it separate from corrected-readiness campaigns and do not subtract medians across campaign hosts.

Timer, initial-notification and no-compaction candidates still include common-channel batching. Their incomplete inventories reject them as whole-product improvements; these campaigns cannot attribute the defect to an isolated timer, notification or compaction change. Every failed candidate in these campaigns times out in the Local session terminal case.

The direct archived `f513` → `5f2` control includes one failed earlier revision and two passing no-common-batching revisions. That supports the reversal on those attempts, but an exact local `5f2` package still fails the same scenario with the original harness while exact upstream passes. The reversal is not established as a complete fix. Local controls with notifications disabled, optional-argument masking disabled, individual native replies and all native batching disabled also stall; metadata tracing can change the outcome. Subsequent model-state evidence identifies the harness readiness race described below. Diagnostic packages do not enter smoke timing statistics.

All artifact ZIP digests were verified before reading the reports. The accompanying JSON contains every attempt, original errors and comparison metadata.

Subsequent isolation identifies an explicit Local chat command-completion race in the harness. The unchanged product passes all six local controls with the identical readiness correction, including baseline and current candidate. See `ipc.smoke.readiness.perf.md` and its raw evidence. Historical timeouts therefore confound attribution to IPC changes; corrected full campaigns are separate and pending.
