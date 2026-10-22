# Complete follow-up campaign outcomes

All comparisons use alternating AB/BA pairs on one runner, identical archived upstream harness and fixture, with every failed attempt retained. These experiments do not establish the requested 10–20% whole-suite gain.

| Campaign | Baseline complete | Candidate complete | Matched complete pairs | Survivor change |
| --- | ---: | ---: | ---: | ---: |
| [timer](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39839075338) | 8 / 8 | 1 / 8 | 1 | -2.68% |
| [notif10](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39844353320) | 6 / 6 | 2 / 6 | 2 | -3.34% |
| [no-compact](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39847409403) | 6 / 6 | 2 / 6 | 2 | +1.25% |
| [direct-no-batch](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39861391952) | 1 / 2 | 2 / 2 | 1 | -0.20% |

All survivor timing estimates above are inconclusive because fewer than three pairs complete. They are not reliable general performance results for failing candidates. The degenerate one-pair intervals in raw harness output provide no useful confidence estimate. Baseline and candidate failures remain in the raw reports; there are no measurement retries or outlier removals.

Timer, initial-notification and no-compaction candidates still include common-channel batching. Their incomplete inventories reject them as whole-product improvements; these campaigns cannot attribute the defect to an isolated timer, notification or compaction change. Every failed candidate in these campaigns times out in the Local session terminal case.

The direct archived `f513` → `5f2` control includes one failed earlier revision and two passing no-common-batching revisions. That supports the reversal on these attempts, but an exact local `5f2` package still fails the same scenario while exact upstream passes. The reversal is not established as a complete fix. Local controls with notifications disabled, optional-argument masking disabled, individual native replies and all native batching disabled also stall; metadata tracing can change the outcome. The observed failed chat view is empty while its model request remains active, so further diagnosis is required. Diagnostic packages do not enter smoke timing statistics.

All artifact ZIP digests were verified before reading the reports. The accompanying JSON contains every attempt, original errors and comparison metadata.

Subsequent isolation identifies an explicit Local chat command-completion race in the harness. The unchanged product passes all six local controls with the identical readiness correction, including baseline and current candidate. See `ipc.smoke.readiness.perf.md` and its raw evidence. Historical timeouts therefore confound attribution to IPC changes; corrected full campaigns are separate and pending.
