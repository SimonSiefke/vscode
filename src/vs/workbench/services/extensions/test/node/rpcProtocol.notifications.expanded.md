# Additional explicit notifications

This candidate adds 93 explicitly named void methods across 14 actors to the existing ten notification methods. It covers language-provider and command registration, search/progress updates, status and telemetry, terminal events and notebook editor updates. It uses the existing native notification protocol and its ordinary-RPC liveness probes.

The audit parses TypeScript call expressions and property references across `src`, including tests. Every selected call is a standalone expression, an ignored event/progress callback result or an explicit `void` expression. There are no awaited, returned, chained, assigned or passed-by-reference selected methods. Callback bodies were inspected to confirm they are event/progress callbacks, rather than completion-sensitive operations. Method names shared by different actors are audited conservatively together.

The list is explicit and checked against each actor interface by TypeScript; no method-name prefix enables notifications. In particular, `$acceptTerminalClosed` stays ordinary RPC because existing callers await it. Value-returning requests, cancellation tokens, mixed/binary arguments and byte transports retain ordinary RPC. Native notifications preserve invocation order, but their fulfilled promises mean enqueue completion rather than handler completion; errors are reported by the receiver.

| Actor | Additional methods |
| --- | ---: |
| MainThreadCommands | 3 |
| MainThreadDecorations | 3 |
| MainThreadDocumentContentProviders | 2 |
| MainThreadTextEditors | 2 |
| MainThreadLanguageFeatures | 45 |
| MainThreadLanguages | 2 |
| MainThreadProgress | 2 |
| MainThreadStatusBar | 2 |
| MainThreadTelemetry | 2 |
| MainThreadSearch | 8 |
| ExtHostLanguages | 2 |
| ExtHostTerminalShellIntegration | 7 |
| ExtHostNotebookEditors | 2 |
| ExtHostTerminalService | 11 |

The complete method list, every callsite and all non-call property references are retained in `rpcProtocol.notifications.audit.json`. The prior notification microbenchmarks exercise the same transport implementation; expanding the metadata does not establish a whole-smoke gain. A separate paired complete-suite campaign is required.

A renderer-to-Electron-utility ArrayBuffer transfer experiment was rejected: the sender detached its 65,554-byte typed-array packet, but the utility process received an empty Buffer. The unchanged cloning control delivered all fixtures. No transfer/detachment production code is included.

Validation: all 1,090 extension API common/browser/node tests pass (three pre-existing pending), along with 238 selected Node tests and 238 Electron tests. Full client typechecking and focused lint pass. The complete-suite result remains pending.
