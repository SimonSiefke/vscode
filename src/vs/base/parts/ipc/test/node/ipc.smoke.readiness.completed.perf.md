# Completed corrected-readiness smoke campaigns

The latest production revision `38b2f1066eedc6cd3395bda950ee1f7e292f9df7` completes all 32 full suites in three campaigns. Every suite passes the identical 62 tests and retains 68 pre-existing pending tests. All pairs have matching inventories, shared archived harness/fixture and identical readiness-correction metadata/hashes. The downloaded artifact ZIP digests were verified before analysis. Every attempt is retained in the accompanying JSON; there are no retries or outlier removals.

| Comparison | Complete pairs | Baseline median | Candidate median | Change | Exploratory paired interval | Assessment |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| [upstream-eight-pairs](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39868742864) | 8 | 558.426 s | 547.393 s | -1.98% | -15.299 to -4.903 s | exploratory interval excludes zero |
| [earlier-PR-four-pairs](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39868746985) | 4 | 553.787 s | 544.402 s | -1.69% | -18.585 to +5.847 s | inconclusive |
| [ACK-increment-four-pairs](https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39868751136) | 4 | 551.806 s | 544.778 s | -1.27% | -35.132 to +0.603 s | inconclusive |

The eight-pair upstream comparison is the primary complete campaign: median smoke-suite time falls 11.033 s, or 1.98%. Its exploratory interval excludes zero. It does **not** establish the requested 10–20% gain. The earlier-PR comparison uses `297a0df7b5dc1388b44a834a29ce0cb909712f5e`; the ACK increment compares `5f2d3bd8d632f37f8c2c226731edd97144da4267` with `38b2`. Those four-pair comparisons remain inconclusive because of sample size and intervals crossing zero.

These campaigns run on separate hosts. Do not subtract medians between campaigns, pool unrelated raw times, or attribute their differences to one optimization. The separate four-runner AB/BA/BA/AB early cohort measured a median within-runner ratio of −4.69%, with an interval spanning −8.10% to +4.38%. It remains a separate exploratory result and is superseded by the complete eight-pair campaign as the primary upstream comparison.

The harness correction waits for the explicit Local chat command to complete before submitting a prompt. It changes no response assertions, enabled tests, mock responses or production code. Historical original-harness results and failures remain separate. Component RPC throughput gains are not smoke-suite gains.
