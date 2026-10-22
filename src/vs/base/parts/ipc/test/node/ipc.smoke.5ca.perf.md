# Byte-codec candidate rejected by complete smoke validation

Campaign: https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39832491507

Compare `5cae459e4aada510c694218fb13d253c8825095b` with archived upstream `4df8bb183f0e984e97d8f4200c802c49061d7d3c`, using the same compiled harness and fixture in eight alternating AB/BA pairs on one runner.

All eight baseline attempts pass the expected 62 cases with 68 pending. **All eight candidate attempts fail**; no complete matched pair exists and no timing comparison is valid. All eight fail `Chat Sessions / Test Local session run in terminal`. Seven also fail seven Linux Chat Sandbox cases: terminal commands, sandbox temporary-directory writes, host temporary-directory blocking, default network access, home-file blocking, disabled network access and configured home-file access. These failures time out waiting for terminal responses or the enabled chat execute control. The complete stdout, original errors and attempts remain in the accompanying JSON and digest-verified Actions artifact. No retries or outlier removal.

This candidate includes the previously introduced common-channel batching as well as the byte-codec change. Therefore this campaign does not by itself establish a byte-codec defect. The preceding `025` common-batching campaign also failed six of eight terminal attempts, while the earlier pre-batching packages completed every suite. Common batching is now removed, and a deterministic MessageChannel test reproduces its request-continuation/event-ordering defect. Current `5f2` full upstream and earlier-PR campaigns, plus a direct `f513` → `5f2` archived-package control, must validate the reversal. Until they finish, no later candidate has established a whole-suite speedup or the 10–20% target.

## Earlier-PR control

https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39836584465 compares the earlier PR `297a0df7b5dc1388b44a834a29ce0cb909712f5e` directly against a separately built `5ca` package, using the same archived harness in eight alternating pairs. All eight earlier-PR attempts pass. Six candidate attempts fail the same local-session terminal case, and only two complete. Their survivor medians are 547.420 s versus 546.914 s (−0.09%, inconclusive; interval −8.845 to +7.835 s). This is another failed candidate campaign, not evidence for a general speedup. All sixteen attempts remain in `oldPRControl` in the result JSON.

The candidate archives in the upstream and earlier-PR campaigns were separately built from the same commit. Their different ZIP digests and complete metadata remain in Actions; the packages are not assumed byte-identical. Current direct `f513` → `5f2` and earlier-PR → `5f2` controls reuse their archived candidate package explicitly.

Subsequent benchmark diagnosis isolates an explicit Local chat command-readiness race: a prompt can be sent into an outgoing startup session before the new Local command completes. The unchanged product passes with a completion wait applied identically to both comparison sides. See `ipc.smoke.readiness.perf.md`. These historical failures do not alone establish that the candidate IPC feature caused the terminal timeouts. All failures and source remain retained; corrected full-suite campaigns are separate and pending.
