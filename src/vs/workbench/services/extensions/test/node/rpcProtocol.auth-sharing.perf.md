# Share concurrent authentication-session RPC reads

An actual packaged smoke diagnostic finds overlapping queries with identical JSON arguments: 12 of 31 session queries in the first launch, three of 17 after restart, and 30 of 47 during the chat launch overlap an already outstanding identical query. Equality is tracked with opaque protocol-local integer IDs; scopes, account details, options and credentials are not exported. Inspector/profiler instrumentation affects scheduling, so these counts identify an opportunity rather than a stable production frequency or speed estimate.

`MainThreadAuthenticationProvider` now shares an outstanding `$getSessions` RPC for the same provider, scopes and complete provider options. Each caller still revives its own session/account wrappers. Coalesced callers share the same success or failure. Completed and failed requests are removed; there is no TTL or completed-session cache. Creating/removing sessions, including challenge-based creation, invalidates sharing before sending the mutation. Provider session events and disposal also invalidate it. A generation check prevents a reentrant invalidation from installing an obsolete request; identity checks prevent an older completion from deleting a newer request. Providers and authorization/account/client options remain separate.

The base provider is disposed by AuthenticationService's existing provider registration owner. Its new event listener and clearing disposable are immediately registered on that lifetime. Disposed providers do not retain newly started requests. Authentication permission checks remain at their existing per-caller layer.

## Component measurements

Use the actual MainThreadAuthentication class and registered provider, a real Electron renderer without Node globals, and a separate utility-process RPC server. The server returns a fixed session through a per-provider SequencerByKey, matching the existing extension-host authentication queue, with no artificial delays or network work. Node main/utility peers use the Linux 8 KiB Buffer pool; the renderer has no Buffer global. Before and after modules use matching esbuild 0.27.2 / ES2024 / decorator settings and the same frozen RPCProtocol/RPCMessagePort implementation. Reference production source: `7700b8`.

Eight randomized blocks (seed 3212512) run both variants in one renderer/utility process pair. Each fixture warms 64 calls per variant, then measures three batches of 256 logical calls. Each group waits for all callers and checks returned session/account/token fixture values. Every batch asserts the actual outgoing RPC request count. Fixture order and variant order are randomized; every result and ordinary/distinct-options control is retained. These are correlated component samples, not independent product runs or whole-smoke gains.

| Pattern | Median time per logical call | Before RPCs / 256 calls | Shared RPCs / 256 calls |
| --- | ---: | ---: | ---: |
| same-8 | -46.45% | 256 | 32 |
| same-32 | -72.19% | 256 | 8 |
| distinct-options-8 | -11.18% | 256 | 256 |
| uncontended | -3.41% | 256 | 256 |
| same-4 | -27.44% | 256 | 64 |

The full raw result, exact sources and compiled hashes are in `rpcProtocol.auth-sharing.perf.results.json`. No outliers or performance retries are used. Uncontended calls and distinct options continue to issue one RPC per caller. Grouped duplicate queries issue one RPC per pending group while returning every caller's result.

## Validation

The baseline emits 64 RPC calls for 64 identical concurrent reads and fails three focused assertions. The selected implementation passes all seven provider tests. Coverage includes pending-only sharing, independent scope/account/client/authorization-server options, failed reads, session-change invalidation, stale completion, mutations before completion, reentrant invalidation and session URI revival. Full validation passes 1,490 combined Electron/API/authentication-service tests with three pre-existing pending cases, plus client typechecking and focused lint. Existing core byte/socket tests remain applicable because the wire format is unchanged.

The previously completed primary smoke campaign is only 1.98% faster than upstream. No additional full-suite gain is claimed for this increment until the archived-package comparisons complete. The requested 10–20% goal remains unverified.
