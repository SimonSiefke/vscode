# Common-channel batching rejected by full smoke tests

Campaign: https://github.com/SimonSiefke/vscode-memory-leak-finder/actions/runs/39825984187

`0252d16f0d5f870e2606726f03bfb4e0cce074eb` versus the identical archived `microsoft/vscode@4df8bb183f0e984e97d8f4200c802c49061d7d3c` build, with the same compiled smoke harness and fixture in eight sequential alternating AB/BA pairs on one runner.

**All eight baseline suites pass. Six of eight candidate suites fail** in `Chat Sessions / Test Local session run in terminal`, timing out while waiting for `MOCKED_CHAT_SESSIONS_LOCAL_TERMINAL_RESPONSE`. Each failed attempt reports 61 passing, 68 pending and one failed case. Both complete candidate suites have the expected 62 passing and 68 pending cases. No assertion or test inventory changes.

The two complete matched pairs have baseline median 567.918 s and candidate median 580.447 s (+2.21%). The harness marks this inconclusive because only two pairs complete. These survivors do not establish a speedup or a reliable performance estimate for the failing candidate. All six failed attempts remain in the raw report and complete artifact ZIP; no measurement retry or outlier removal is performed.

The candidate was attractive in isolated burst benchmarks, but the complete product campaign rejects it. This change removes the default common-channel batch adapters, their native close-flush hooks and the unused adapter/test module. The eleven retired tests cover only that removed batching feature. Existing common channel, byte codec, graph, URI, cancellation, ordering and snapshot coverage remains. Original adapter/test source is retained inside the result evidence, alongside the earlier microbenchmarks.

The exact terminal failure mechanism is not established. Failed-case logs show a pty host starting and the tool waiting until its 120-second response timeout; shell integration also warns about missing capabilities. The isolated change from the previously successful 9ec campaign motivates disabling this batching path, but an additional complete-suite campaign is required to verify the fix.

Extension-host RPC batching is separate and remains enabled. The tightly sized RPC buffers, native JSON, buffer-reference parser, responsiveness timer reuse, explicit notifications, optional-argument masks and completion-aware chat progress delivery remain. Native buffer compaction and bulk byte-array JSON encoding were already held independently.

After this reversal, 239 selected Node cases and 1,330 combined Electron/API cases pass (three pre-existing pending), with six child-process cases. Full client typechecking, focused lint and hygiene are checked before pushing. The requested 10–20% whole-smoke target remains unproven.

A real Node MessageChannel regression probe now reproduces a concrete ordering change: after a `create` request, a separately posted `ready` event must run after the caller's Promise continuation. The retired batching path reports `created: false` in that event; individual MessagePort deliveries report `created: true`. The repository test fails against the frozen batched channel module (four other cases pass) and passes in Node and Electron after removal. This establishes the ordering defect, not its role in the terminal smoke timeout. The archived-package direct product control remains necessary.
