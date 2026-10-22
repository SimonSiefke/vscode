# Chat progress notifications

Normal chat progress batches do not need the remote completion result. The sender now uses an explicitly named notification method when its completion-waiter list is empty. Two receiver wrappers reuse the existing chat-agent/session handlers and return their promises so notification errors are reported by the RPC receiver. Batches with waiters, including both phases of external edits, retain the original ordinary RPC and `finally` completion path. Byte transports also retain ordinary request/reply delivery.

This measures the real `ChatAgentResponseStream` sender over actual Node MessageChannels and Electron renderer/utility MessagePorts, with an equivalent receiver counting complete progress chunks. The receiver does not render the workbench or perform real external file edits. Both sides use the same frozen `9fa339be` RPC implementation, so these results isolate chat delivery from the optional-argument optimization.

Eight randomized before/after process blocks, three measured batches each, matching esbuild settings and Linux 8 KiB Buffer pools. Ordinary RPC is primed with 200 completed calls; each fixture warms with 128 turns or operations. Every sample finishes with an ordinary barrier and checks the exact count and final content. The external-edit control awaits both normal progress acknowledgements. Every final control and the complete pilot are retained.

| Fixture | Node change | Electron renderer change |
| --- | ---: | ---: |
| markdown-1x128 | -20.80% | -30.80% |
| markdown-32x128 | -2.28% | -7.46% |
| markdown-4KiB-1x128 | -9.40% | -1.92% |
| external-edit-32 | +5.43% | -6.78% |

Markdown results are elapsed microseconds per delivered chunk, including conversion, serialization and the barrier. `1x128` sends one chunk in each of 128 microtask turns; `32x128` sends 32 chunks in each turn. Each measured external-edit fixture completes 32 operations, with two acknowledged phases per operation. These are throughput/control measurements, not a complete chat response or smoke-suite speedup.

The pilot used only eight streaming warm-up turns and four external-edit operations. Its external-edit controls regressed 8.0% in Node and 9.76% in Electron after the baseline had warmed ordinary RPC through streaming while the notification candidate had not. The final comparison warms ordinary RPC equally, retains the same fixtures and still reports the +5.43% Node control. No final outliers or controls are removed.

Two API regressions verify that all 64 ordinary chunks arrive in order via two notification batches, and that external edits neither start the callback nor complete the operation until their respective ordinary RPC acknowledgements arrive. Existing anchor-resolution ordering and edit DTO coverage are retained. The combined Electron/API inventory passes 1,341 cases with three pre-existing pending, alongside 250 selected Node cases and six child-process cases. Full client typechecking, focused lint and hygiene are checked for the final candidate.

Complete smoke comparisons remain necessary. These measurements do not establish the requested 10–20% whole-suite target.
