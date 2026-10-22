# Control without native compaction and bulk byte-array JSON encoding

This candidate reverses the production changes from `9ec9dde1b2d141b3ab2ee327edc9c15e1ea17348` in the common channel codec. It keeps the byte cursor/VQL cache, native channel batching, hybrid JSON/native DTO path, inactive-role filtering, extension RPC buffer/parser optimizations, timer reuse and explicit notifications.

The motivation is the complete eight-pair 9ec smoke campaign: +3.75% suite time versus its matched upstream baseline, despite favorable local serialization measurements. Much of the mean difference is concentrated in approximately 16-second pauses in one AgentHost scenario. The relationship to these two optimizations is not established. A direct 813-to-9ec archived-package comparison is also running. This reversal is an experiment, not a causal conclusion.

Native standalone byte payloads again retain their original backing-store representation. Byte primitive arrays use their legacy per-element format. Old and new peers retain format compatibility. Tests specific to the removed compaction/JSON fast paths are removed with those paths; the remaining codec, graph, cancellation, buffer and snapshot coverage is retained. Historical methods and raw measurements remain in the repository.

238 selected Node tests, 238 Electron tests, 106 relevant extension API tests and six child-process IPC integration tests pass, with full client typechecking. A new complete-suite comparison is required to select between the two variants. No smoke assertions, enabled tests or fixture behavior change.
