# Structured-clone RPC

`StructuredCloneRPCProtocol` implements `IRPCProtocol` independently of the byte-based `RPCProtocol`. Local renderer/extension-host MessagePorts select it explicitly through `IStructuredCloneRPCTransport`. Remote sockets and web workers retain the byte engine. The byte engine does not inspect notification or observed-promise metadata.

## Transport and scheduling

The byte stream carries initialization and termination only. Native RPC has its own buffered event, so a handshake listener cannot consume early RPC traffic. A frame with header zero carries the compatibility byte codec, including mixed/binary payloads, errors and cancellation. Other headers pack request ID and message type arithmetically, without truncating IDs through bitwise shifts. Native frames never hide inside empty `VSBuffer` objects.

The transport owns batching: the first outgoing frame after a receive is immediate; subsequent small frames coalesce up to 64 frames / 16 Ki-characters. Binary envelopes and handshake/control sends flush queued frames first. `drain()` flushes queued sends, not remote handlers. Disposal drops queued traffic, releases subscriptions after the current broadcast, and prevents the rest of a received batch from firing. Reentrant receives queue behind the current batch. Tests can disable batching through the transport constructor to isolate its cost.

The acknowledgement policy allows three microtasks for short promise chains to reply. A reply acknowledges its request once; an unfinished actor sends an explicit acknowledgement before yielding to another task. The grace period is named and bounded, rather than embedded as nested callbacks. Reply flushing after an acknowledgement belongs to the request that sent that acknowledgement. Cancellation sources belong to invoked requests and are released on completion, cancellation or engine disposal.

## Notification audit

The following entries enumerate the notification metadata in `extHost.protocol.ts`. Their production call sites do not consume an RPC completion or propagated rejection; remote handler failures go to `onUnexpectedError`. The returned notification promise means enqueued, not executed. A cancellation token or mixed payload retains a full request/reply, and notification-only traffic periodically uses a request as a liveness probe. Do not add a method here if callers require remote completion, a result or an error.

| Actor | Methods | Why a reply is unnecessary |
| --- | --- | --- |
| MainThreadChatAgents2 | `$handleProgressChunkNotification` | Progress reports are ordered updates; completion remains on the enclosing request. |
| MainThreadChatSkills | `$registerTool`, `$registerToolWithDefinition`, `$unregisterTool`, `$acceptToolProgress` | Tool registrations, removal and progress are ordered messages; tool invocation remains completion-bearing. |
| MainThreadCommands | `$registerCommand`, `$unregisterCommand`, `$fireCommandActivationEvent` | Registration and activation announcements have no API completion result; command execution still replies. |
| MainThreadDecorations | `$registerDecorationProvider`, `$unregisterDecorationProvider`, `$onDidChange` | Provider lifecycle and invalidation announcements carry no queried decoration result. |
| MainThreadDiagnostics | `$changeMany`, `$clear` | Collection updates and clears are synchronous API operations; callers do not observe remote completion. |
| MainThreadDocumentContentProviders | `$registerTextContentProvider`, `$unregisterTextContentProvider` | Provider lifecycle messages precede subsequent requests on the same ordered stream. |
| MainThreadTextEditors | `$registerTextEditorDecorationType`, `$removeTextEditorDecorationType` | Decoration-type registration and removal are synchronous API operations. |
| MainThreadLanguageFeatures | `$unregister`, `$registerDocumentSymbolProvider`, `$registerCodeLensSupport`, `$emitCodeLensEvent`, `$registerDefinitionSupport`, `$registerDeclarationSupport`, `$registerImplementationSupport`, `$registerTypeDefinitionSupport`, `$registerHoverProvider`, `$registerEvaluatableExpressionProvider`, `$registerInlineValuesProvider`, `$emitInlineValuesEvent`, `$registerDocumentHighlightProvider`, `$registerMultiDocumentHighlightProvider`, `$registerLinkedEditingRangeProvider`, `$registerReferenceSupport`, `$registerCodeActionSupport`, `$registerPasteEditProvider`, `$registerDocumentFormattingSupport`, `$registerRangeFormattingSupport`, `$registerOnTypeFormattingSupport`, `$registerNavigateTypeSupport`, `$registerRenameSupport`, `$registerNewSymbolNamesProvider`, `$registerDocumentSemanticTokensProvider`, `$emitDocumentSemanticTokensEvent`, `$registerDocumentRangeSemanticTokensProvider`, `$emitDocumentRangeSemanticTokensEvent`, `$registerCompletionsProvider`, `$registerInlineCompletionsSupport`, `$emitInlineCompletionsChange`, `$emitInlineCompletionModelInfoChange`, `$emitInlineCompletionProviderOptionsChange`, `$registerSignatureHelpProvider`, `$registerInlayHintsProvider`, `$emitInlayHintsEvent`, `$registerDocumentLinkProvider`, `$registerDocumentColorProvider`, `$registerFoldingRangeProvider`, `$emitFoldingRangeEvent`, `$registerSelectionRangeProvider`, `$registerCallHierarchyProvider`, `$registerTypeHierarchyProvider`, `$registerDocumentOnDropEditProvider`, `$setLanguageConfiguration` | Provider lifecycle, configuration and invalidation messages precede subsequent provider requests; actual language-feature requests still reply. |
| MainThreadLanguages | `$setLanguageStatus`, `$removeLanguageStatus` | Language status entries are synchronous UI updates. |
| MainThreadProgress | `$progressReport`, `$progressEnd` | Progress and end announcements do not complete the enclosing progress operation. |
| MainThreadStatusBar | `$setEntry`, `$disposeEntry` | Entry updates and disposal have no API completion result. |
| MainThreadTelemetry | `$publicLog`, `$publicLog2` | Telemetry enqueueing exposes no remote result or error to the caller. |
| MainThreadTerminalService | `$setEnvironmentVariableCollection`, `$dispose`, `$hide`, `$sendText`, `$show`, `$sendProcessData`, `$sendProcessReady`, `$sendProcessProperty`, `$sendProcessExit` | Terminal UI/process announcements and lifecycle updates are unobserved sends. Terminal creation retains an observed completion. |
| MainThreadFileSystemEventService | `$watch`, `$unwatch` | Watch registration/removal are lifecycle messages; watch failures use the dedicated event/error path. |
| MainThreadSearch | `$registerFileSearchProvider`, `$registerAITextSearchProvider`, `$registerTextSearchProvider`, `$unregisterProvider`, `$handleFileMatch`, `$handleTextMatch`, `$handleKeywordResult`, `$handleTelemetry` | Provider lifecycle, matches, keyword results and telemetry are ordered callbacks. Search completion remains on the original request. |
| MainThreadChatStatus | `$setEntry`, `$disposeEntry` | Status-entry updates and disposal have no API completion result. |
| MainThreadChatSessions | `$handleProgressChunkNotification` | Progress is an ordered notification; its enclosing request retains completion. |
| ExtHostConfiguration | `$acceptConfigurationChanged` | Configuration change delivery publishes state; the provider-acquisition promise does not expose RPC completion. |
| ExtHostDocumentsAndEditors | `$acceptDocumentsAndEditorsDelta` | Document/editor deltas publish state in FIFO order; callers do not await delivery. |
| ExtHostDocuments | `$acceptModelLanguageChanged`, `$acceptModelSaved`, `$acceptDirtyStateChanged`, `$acceptEncodingChanged`, `$acceptModelChanged` | Model state changes publish ordered events without a result. |
| ExtHostEditors | `$acceptEditorPropertiesChanged`, `$acceptEditorPositionData` | Editor state and position announcements publish ordered events without a result. |
| ExtHostFileSystemInfo | `$acceptProviderInfos` | Provider capabilities publish state without a result. |
| ExtHostFileSystemEventService | `$onFileEvent` | File event delivery publishes an event batch without a result. |
| ExtHostLanguages | `$acceptLanguageIds`, `$acceptSyntaxHighlightingThemeChanged` | Language IDs and syntax theme changes publish state without a result. |
| ExtHostTerminalService | `$acceptTerminalOpened`, `$acceptActiveTerminalChanged`, `$acceptTerminalProcessId`, `$acceptTerminalProcessData`, `$acceptDidExecuteCommand`, `$acceptTerminalTitleChange`, `$acceptTerminalDimensions`, `$acceptTerminalMaximumDimensions`, `$acceptTerminalShellType`, `$initEnvironmentVariableCollections`, `$acceptDefaultProfile` | Terminal state/process events publish ordered notifications without a result. Closure and process-start operations that need completion remain requests. |
| ExtHostTerminalShellIntegration | `$shellIntegrationChange`, `$shellExecutionStart`, `$shellExecutionEnd`, `$shellExecutionData`, `$shellEnvChange`, `$cwdChange`, `$closeTerminal` | Shell state and start/data/end publish ordered events. Immediate read registration is synchronous; the primed real-port regression covers batched output. |
| ExtHostWorkspace | `$acceptWorkspaceData` | Workspace data publishes state without a result. |
| ExtHostNotebookEditors | `$acceptEditorPropertiesChanged`, `$acceptEditorViewColumns` | Notebook-editor properties and columns publish state without a result. |
| ExtHostTheming | `$onColorThemeChange` | Theme changes publish state without a result. |
| ExtHostDataChannels | `$onDidReceiveData` | Received data publishes an event without a result. |

Terminal creation and SCM cleanup retain completion-bearing requests. Registration order is preserved on the wire, but application code must establish its own async reader/consumer readiness; batching does not promise a microtask between notifications.

## Observed promises

These methods retain remote completion and rejection. Audited API bridges observe their returned promises; other calls retain lazy replies, including mixed/binary fallbacks. A `void` actor signature alone is not permission to drop completion. These entries only affect the native engine.

| Actor | Observed methods |
| --- | --- |
| MainThreadLanguageModels | `$selectChatModels` |
| MainThreadEmbeddings | `$computeEmbeddings` |
| MainThreadChatAgents2 | `$transferActiveChatSession` |
| MainThreadChatSkills | `$invokeTool` |
| MainThreadCommands | `$executeCommand` |
| MainThreadDocumentContentProviders | `$onVirtualDocumentChange` |
| MainThreadTextEditors | `$tryShowTextDocument` |
| MainThreadEditorTabs | `$closeTab`, `$closeGroup` |
| MainThreadLanguages | `$computeFullSyntaxHighlighting`, `$changeLanguage`, `$tokensAtPosition` |
| MainThreadOutputService | `$register` |
| MainThreadStorage | `$initializeExtensionStorage` |
| MainThreadTerminalService | `$createTerminal` |
| MainThreadUrls | `$createAppUri` |
| MainThreadWorkspace | `$save`, `$resolveDecoding`, `$resolveEncoding` |
| MainThreadExtensionService | `$activateExtension`, `$getExtension` |
| MainThreadTask | `$createTaskId`, `$getTaskExecution` |
| MainThreadWindow | `$asExternalUri` |
| MainThreadPower | `$startPowerSaveBlocker` |
| MainThreadNotebookDocumentsShape | `$tryCreateNotebook`, `$tryOpenNotebook` |
| MainThreadNotebookEditorsShape | `$tryShowNotebookDocument` |
| MainThreadTunnelService | `$openTunnel`, `$getTunnels` |
| MainThreadTesting | `$runTests` |
| MainThreadLocalizationShape | `$fetchBundleContents`, `$fetchBuiltInBundleUri` |
| MainThreadMcpShape | `$startMcpGateway` |
| MainThreadChatContext | `$updateWorkspaceContextItems` |
| MainThreadBrowsers | `$openBrowserTab` |
| ExtHostLanguageFeatures | `$provideHover` |
| ExtHostChatSkills | `$invokeTool` |

## Performance evidence

Use the fixed-work RPC comparison to distinguish codec, bookkeeping and batching costs. Count completed actor calls and packets, and report elapsed time separately from CPU work. Allocation diagnostics use separate instrumented processes. Real UI scenarios validate integration with a frozen fixture/harness and 37 operations per scenario; independent application launches, rather than individual operations within a launch, are the statistical unit. Startup and total suite duration are regression indicators. Historical evidence does not establish performance of a refactored implementation; see the IPC performance report for current validation and revision-qualified results.
