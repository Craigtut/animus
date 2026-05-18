# Changelog

All notable changes to the Animus Engine will be documented in this file.

This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/).

## [0.4.5](https://github.com/Craigtut/animus/compare/v0.4.4...v0.4.5) (2026-05-18)

### Bug Fixes

* **cortex:** support remote OAuth sign-in ([822c308](https://github.com/Craigtut/animus/commit/822c308813628c1066504b17d174d58aa23230f6))
* **db:** preserve file-backed save assets ([5ffae0a](https://github.com/Craigtut/animus/commit/5ffae0ae1a8a77b3b4b416a99e0ff575033356b7))
* **heartbeat:** require provider before heartbeat start ([1e674a4](https://github.com/Craigtut/animus/commit/1e674a4da55b637ab1d26f5b1189fce9585f765f))

## [0.4.4](https://github.com/Craigtut/animus/compare/v0.4.3...v0.4.4) (2026-05-18)

### Bug Fixes

* **agents:** clean legacy sdk data directory ([8c9cbd0](https://github.com/Craigtut/animus/commit/8c9cbd0f1e6b6241c783928b9b69f3dbdaa8536c))
* **backend:** support older save archive restores ([871e2e0](https://github.com/Craigtut/animus/commit/871e2e099006cd043c8b185a48b37bdbbeae290c))

## [0.4.3](https://github.com/Craigtut/animus/compare/v0.4.2...v0.4.3) (2026-05-18)

### Bug Fixes

* **ci:** gate tts-native accelerate feature on macos ([c4e49b3](https://github.com/Craigtut/animus/commit/c4e49b332cfd1e41d2e1fa337de1c99cbb23b3cb))
* **ci:** include backend assets in docker image ([e060c86](https://github.com/Craigtut/animus/commit/e060c860cadfb593212219ac0499c247fd093927))

## [0.4.2](https://github.com/Craigtut/animus/compare/v0.4.1...v0.4.2) (2026-05-17)

### Bug Fixes

* **agents:** use crypto random session ids ([26ae1e7](https://github.com/Craigtut/animus/commit/26ae1e7af9c519d86fb8f6863cb06a6156a78570))
* **backend:** harden file paths and rate limits ([cfea408](https://github.com/Craigtut/animus/commit/cfea40816e8a1aef2a0a3897a6e88a8ed184d2c6))
* **ci:** restrict workflow permissions ([6487337](https://github.com/Craigtut/animus/commit/6487337b7e6a843b3200a89b465f957223eb7c4e))
* **tauri:** export saves through desktop app ([17ea625](https://github.com/Craigtut/animus/commit/17ea625a60035a727d4f5680327e869b50228aa0))
* **tauri:** own port in app run callback ([eccc90e](https://github.com/Craigtut/animus/commit/eccc90e9d387202b4ca4ddb70957133077085f51))

## [0.4.1](https://github.com/Craigtut/animus/compare/v0.3.3...v0.4.1) (2026-05-17)

### Features

* add Windows Tauri shutdown, Docker OAuth matrix, Dockerfile, channel delivery ([59edd83](https://github.com/Craigtut/animus/commit/59edd834b058c0bd8d2f7a98b273daf3a04d7abc))
* **auth:** add CortexCredentialService, provider router, and frontend auth UX ([128d5db](https://github.com/Craigtut/animus/commit/128d5dbfde4e65dd7e75d9526f4e957c1971a7ec))
* **backend:** add usage store, budget service, and usage tRPC router ([1a45fc7](https://github.com/Craigtut/animus/commit/1a45fc7687ab938642767810f1ce0981207e537d))
* **backend:** brand the OAuth callback page with the Animus symbol ([e764700](https://github.com/Craigtut/animus/commit/e7647003321c4b3bff27caa162d127b131b15bfa))
* **channels:** add primary resolution mode, speech IPC, and reply streaming ([1ff0cb1](https://github.com/Craigtut/animus/commit/1ff0cb1bbccffd1ad9529e3541b4ac6aed5d0341))
* **cortex:** add @animus-labs/cortex package with types and pure utilities ([c3b6377](https://github.com/Craigtut/animus/commit/c3b637702fdd525b44fb58f56fde2f18bab3d50f))
* **cortex:** add 8 enhanced bash security validators ([7b2d39b](https://github.com/Craigtut/animus/commit/7b2d39bd59796a6a8fe3f937ad05538bd0ac5955))
* **cortex:** add compaction circuit breaker, disk persistence, and aggregate budgeting ([97ed6a0](https://github.com/Craigtut/animus/commit/97ed6a004e9e1cff5f3a72afae7bceeb8c3944a3))
* **cortex:** add CortexAgent core with ContextManager, EventBridge, and BudgetGuard ([fcaa7da](https://github.com/Craigtut/animus/commit/fcaa7da254277469bc313dd6495107fd1f5f9df9))
* **cortex:** add envOverrides for subprocess env propagation ([928d4a3](https://github.com/Craigtut/animus/commit/928d4a3c055290a896bdbca73406d1da28f38182))
* **cortex:** add McpClientManager for plugin tool integration ([2845e0c](https://github.com/Craigtut/animus/commit/2845e0ccc27134cbf35754d52d1893cd70f343d5))
* **cortex:** add PRIMARY_MODEL_DEFAULTS, filter model aliases, default thinking to medium ([f898844](https://github.com/Craigtut/animus/commit/f898844e743a6862ca2067bf140dd9be854a2b3c))
* **cortex:** add provider manager, built-in tools, and model tier resolution ([fce112f](https://github.com/Craigtut/animus/commit/fce112f46d873201bf49da78de4d20345940206e))
* **cortex:** add provider manager, model wrapper, and provider registry ([57f4c97](https://github.com/Craigtut/animus/commit/57f4c97a7f5f88eb8f0ad2d1cf2ebea0af98fe5b))
* **cortex:** add steer, directComplete, and create factory to CortexAgent ([267ca07](https://github.com/Craigtut/animus/commit/267ca07a7e40fea98411e3caed5204a97e0a9762))
* **cortex:** add SubAgent tool, skill system, and sub-agent manager ([190036f](https://github.com/Craigtut/animus/commit/190036f024b4b65d88fab3f82be72bac40ddb08b))
* **cortex:** adopt 0.2.4 programmatic utility models and hardened OAuth errors ([0ed6f22](https://github.com/Craigtut/animus/commit/0ed6f229f3c015a3e6cb5da601fa05e9318b0632))
* **cortex:** enable deferred MCP tool loading and prompt watchdog diagnostics ([2c91aee](https://github.com/Craigtut/animus/commit/2c91aee08c294f924808ad9e3ce6af94f7bbd53b))
* **cortex:** overhaul agent framework core ([62dd351](https://github.com/Craigtut/animus/commit/62dd3510a4b0ed4adf9bd799acdf9a2a7ca137fb))
* **cortex:** persist oversized tool results to disk with observation GC ([b218200](https://github.com/Craigtut/animus/commit/b21820036ed6607fc4219de10202b6b7f06d7f59))
* **cortex:** treat observation text as a live reference source for tool-result GC ([afbcde4](https://github.com/Craigtut/animus/commit/afbcde41188a4bc9e0a70694faa94468c578529b))
* **cortex:** upgrade grep to bundled ripgrep, add read dedup and device path blocking ([6f6af6d](https://github.com/Craigtut/animus/commit/6f6af6d31169d5a20c1ab400e360dcef7c4ed209))
* **cortex:** use tool-call-as-structured-output for THOUGHT/REFLECT, fix double reply ([1af5b5e](https://github.com/Craigtut/animus/commit/1af5b5e71aaf8e394eb374fe7740645d868bb1de))
* **cortex:** wire orchestrator sub-agents, plugin skills, and adaptive compaction ([b82b28e](https://github.com/Craigtut/animus/commit/b82b28e00272eb3d09d8adf3cae298a77eb0c156))
* **db:** add sessions.db as 8th database for per-thread conversation state ([bd3d7fe](https://github.com/Craigtut/animus/commit/bd3d7fee30900ac9dc05248117af8b1ce63700b1))
* **db:** add usage enhancements and budget settings schema ([3e60f8f](https://github.com/Craigtut/animus/commit/3e60f8f07a8290d4c26d56a501c73627e4e8052a))
* **db:** change default thinking level from off to high ([844c4a0](https://github.com/Craigtut/animus/commit/844c4a02a3f120ba877e25a692471d19ebf1c5fe))
* **frontend:** add pill tabs to heartbeat detail, proportional token correction, and tooltips ([d1aa887](https://github.com/Craigtut/animus/commit/d1aa887e27a0b0ba6fec799b50530c49014e24c0))
* **frontend:** add Switch Provider modal, OAuth expiry display, and disconnected state ([6798b3d](https://github.com/Craigtut/animus/commit/6798b3d1760b5c8202fd305b67f98e60a6f63ba1))
* **frontend:** add tool config UI, channel config fields, and voice settings ([b0b0d3c](https://github.com/Craigtut/animus/commit/b0b0d3c34617c69eeac992c7dea23c0c663356ce))
* **frontend:** add usage dashboard with charts, budget management, and hard-stop banner ([6222f25](https://github.com/Craigtut/animus/commit/6222f2501f5d337f5e345ce663428acaf0bafb3d))
* **frontend:** dynamic provider registry driven by Cortex pi-ai 0.74 ([37a89fb](https://github.com/Craigtut/animus/commit/37a89fbee3152e56f55756f51a82698109d1cdd4))
* **frontend:** move Usage page into Settings subnav under AI Provider ([dac5c4d](https://github.com/Craigtut/animus/commit/dac5c4d1d78ae2f4802b99238e58939d882b8ede))
* **frontend:** update PWA icons and add maskable variants ([adaa80a](https://github.com/Craigtut/animus/commit/adaa80aa559f2b91f065180d2b398eaa956ef5ae))
* **heartbeat:** add cortex environment override helpers ([3f829bd](https://github.com/Craigtut/animus/commit/3f829bd00ecf9809360b2ba1dfcf80b5c83294db))
* **heartbeat:** add cortex mind and 5-phase pipeline (Phase 2A partial) ([a8a32c3](https://github.com/Craigtut/animus/commit/a8a32c3af46aae01aa571bfbc420b0e9cb5e0e36))
* **heartbeat:** implement per-(contact, channel) session threading ([9c46ca1](https://github.com/Craigtut/animus/commit/9c46ca102c1662642b973ccd16d0457de7235164))
* **heartbeat:** integrate budget gating, throttle, context injection, and maintenance ([39a4013](https://github.com/Craigtut/animus/commit/39a401357aa7496d71b86b1a30a0e9ea8c7c5d72))
* **heartbeat:** persist Cortex observational memory state per session ([1d36b67](https://github.com/Craigtut/animus/commit/1d36b67d0b4d12f197a15a6814a229e88af8b458))
* **heartbeat:** redesign tick detail with phase-grouped timeline and per-phase context capture ([c32fa94](https://github.com/Craigtut/animus/commit/c32fa94aef15bf0517fdcdd4b5cc8ba2698835e7))
* **heartbeat:** wire cortex pipeline into heartbeat tick system ([a3079e1](https://github.com/Craigtut/animus/commit/a3079e1b94413e7044a97a18db26a99779541635))
* **memory:** add message embedding with LanceDB and recall callback for Cortex ([f7cc661](https://github.com/Craigtut/animus/commit/f7cc661259aa9d7836629c709a70d3129a004bde))
* **plugins:** compute MCP tool permission preview at package verify time ([e3429f0](https://github.com/Craigtut/animus/commit/e3429f095a16d2ff39d93cbeb80c3ef637155661))
* **plugins:** install-time per-tool permission picker in consent dialog ([b834b25](https://github.com/Craigtut/animus/commit/b834b25ee3a5bdf286a841ebd8f3daed799e8aa4))
* **plugins:** per-tool risk tiers for plugin MCP tool permissions ([e15d04f](https://github.com/Craigtut/animus/commit/e15d04f0ec442fc6f5f585ddaff7b56eb673969a))
* **plugins:** seed install-time tool permission choices as locked overrides ([7e6eb23](https://github.com/Craigtut/animus/commit/7e6eb23e2234ed7f4c1c9048b9c42d82c75706ef))
* **plugins:** treat plugin manifest risk tier as authoritative (remove safety floor) ([f806aad](https://github.com/Craigtut/animus/commit/f806aad0ece8f3afdfadfef135e255023c0d7226))
* **shared:** add Cortex integration types and token utils ([3a219dc](https://github.com/Craigtut/animus/commit/3a219dc01b382c24910622b87d6e30c98512f3b8))
* **shared:** add tool UI config, channel resolution types, and gather event types ([89d2c53](https://github.com/Craigtut/animus/commit/89d2c5342201ae637445c95cc25bdb4abadcb4ce))
* **speech:** add streaming TTS endpoint for HA voice integration ([c331606](https://github.com/Craigtut/animus/commit/c331606c59469081f980c60ed3a09962e11db8c8))
* **speech:** replace Candle TTS backend with xn-ptts for 2x performance improvement ([2681613](https://github.com/Craigtut/animus/commit/26816130c4d47d139fa182b2e69a369708f05971))
* **usage:** wire Cortex usage tracking into agent_logs for all LLM call paths ([a1bd1b4](https://github.com/Craigtut/animus/commit/a1bd1b43bb0d06a0189fed85e658dc04e088737c))

### Bug Fixes

* **auth:** handle pi-ai onAuth object shape for OAuth URL ([4a1ee64](https://github.com/Craigtut/animus/commit/4a1ee64802ecc08a65880cf9bcc1e8e7d9cedba6))
* **auth:** resolve double encryption, add thinking levels, pause on provider-removed ([7ca5ef5](https://github.com/Craigtut/animus/commit/7ca5ef5e298f86a0bbe25c3eeea3b19e2935b1cb))
* **auth:** unify JWT secret resolution so WebSocket and HTTP auth share one key ([94651da](https://github.com/Craigtut/animus/commit/94651da224cd66f496ef6c122abc63494c337984))
* **backend:** add SubAgent to cortex built-in tool permissions ([f5a3899](https://github.com/Craigtut/animus/commit/f5a389955282cd4500f09ba7b4111f2b56e4d039))
* **backend:** unify tool permission gate and fix plugin MCP approval loop ([191453f](https://github.com/Craigtut/animus/commit/191453f37f17dbe78e77c31b58758d1c70602bfb))
* **channels:** scope reply stream bridge by requestId to prevent cross-talk ([89c5f41](https://github.com/Craigtut/animus/commit/89c5f41b422614f25d031f77dd4aa91fa0a580bd))
* **cortex:** align Animus tool wrapper with CortexTool contract ([da1cfee](https://github.com/Craigtut/animus/commit/da1cfee4583a00026329b0d0b345bcc9ada09af2))
* **cortex:** correct onTurnComplete test expectation for working tags ([2d45061](https://github.com/Craigtut/animus/commit/2d4506115670914b9e0b48cbe683cec93ee19c98))
* **cortex:** deduplicate defaults, fix isAborted/isRunning, guard event listeners ([13624d1](https://github.com/Craigtut/animus/commit/13624d1f2bde255d573ab180f7ecc1fb3955781a))
* **cortex:** handle Zod v3 schemas in converter, make pi-ai/pi-agent-core direct deps ([b14ad47](https://github.com/Craigtut/animus/commit/b14ad470c2979700284e7b23a43cc5e858be8adc))
* **cortex:** make pi-ai and pi-agent-core direct dependencies, pin to ^0.58.0 ([c628609](https://github.com/Craigtut/animus/commit/c6286093b1813d69b679c35c8e82cba179881534))
* **cortex:** pass API key to directComplete/structuredComplete, fix Agent constructor format ([ce2cc35](https://github.com/Craigtut/animus/commit/ce2cc35e8e6ad4ba08377d12645a7a880db0dd27))
* **cortex:** pass native pi-ai messages to structuredComplete, fix REFLECT phase ([70550b0](https://github.com/Craigtut/animus/commit/70550b0a8c45958dafbd78f8c23a7ae3b143091e))
* **cortex:** register MCP tools on agent, rebuild prompt on plugin events, fix compaction ([bdd54e1](https://github.com/Craigtut/animus/commit/bdd54e16940ac147f282ba9f7fd1bd26ac563780))
* **cortex:** resolve final review findings (B1-B3, A1-A2) ([e57b946](https://github.com/Craigtut/animus/commit/e57b946f774a207933531e24631353629c9a57cd))
* **cortex:** resolve security findings (compound commands, SSRF, classifier, env, IP validation) ([dba1d7d](https://github.com/Craigtut/animus/commit/dba1d7d89ea634e57dcbd48874b2a1efdacd0a32))
* **cortex:** strip extra OAuth cache breakpoint, remove reflection instructions from agentic loop ([ae3fe0f](https://github.com/Craigtut/animus/commit/ae3fe0fdd2276cf281d67eb76b646d33aa3e4a21))
* **cortex:** use agent.prompt() not agent.run(), fix model ID mapping ([5234478](https://github.com/Craigtut/animus/commit/52344787e00dad44cf9d29c386f2e386f9890f83))
* **cortex:** use dynamic imports in schema converter for ESM compatibility ([6a86948](https://github.com/Craigtut/animus/commit/6a86948d80bc7daf532b3378616bb10de76785da))
* **frontend:** center Presence empty state above message input ([f7f66fe](https://github.com/Craigtut/animus/commit/f7f66fe325b7525f5cd4cef93f91348f32c0bf65))
* **frontend:** clear stale OAuth state and trim copy in onboarding provider step ([45737fe](https://github.com/Craigtut/animus/commit/45737fe9b7aca8e0a55e069d65fc34e3a7186397))
* **frontend:** fix infinite re-render loop on cortex provider settings page ([e1f217e](https://github.com/Craigtut/animus/commit/e1f217ea60655b1c0238d9c39485c8ebf5efcdc0))
* **frontend:** let onboarding review Edit jump to a step and return to review on save ([8068e55](https://github.com/Craigtut/animus/commit/8068e55ab38ae15d00e31a8ba92b98e37081fa38))
* **heartbeat:** enforce ask permission for plugin MCP tools ([18fd0ea](https://github.com/Craigtut/animus/commit/18fd0ea08e1ad8cc77386a5d20ba435b2f880531))
* **heartbeat:** map loop_start and loop_end cortex events ([d3bfb49](https://github.com/Craigtut/animus/commit/d3bfb496fad20e0b7f23f7d94d7215b65c0459c2))
* **heartbeat:** prevent message injection into deferred thought in low-latency mode ([13a83a6](https://github.com/Craigtut/animus/commit/13a83a61a8a47319015d0cbb6cdf7901ad4b3da6))
* **heartbeat:** queue follow-up messages instead of dropping them mid-tick ([3fbddb0](https://github.com/Craigtut/animus/commit/3fbddb04d5d97cbe268fe38fb0180445e3c5ef48))
* **heartbeat:** remove call to nonexistent setDebugLog on CompactionManager ([5b0d7d2](https://github.com/Craigtut/animus/commit/5b0d7d208ca1af5b32b695c6d3de45d691830d16))
* **heartbeat:** remove dead silent-error check, add cortex to AgentProvider ([3e1319c](https://github.com/Craigtut/animus/commit/3e1319c3e8e3870f1840a95525cd0610ae0a94fb))
* **heartbeat:** remove pi-ai import, fill pipeline stubs, add missing ephemeral sections ([6289e8f](https://github.com/Craigtut/animus/commit/6289e8fba2f13d977a8ca84271fbdf19669897f7))
* **heartbeat:** restore context headers, framing, and cross-contact messages from pre-Cortex system ([c2f22f4](https://github.com/Craigtut/animus/commit/c2f22f4ee9ea7b3b1b6ca5293c182a996041b7ef))
* **heartbeat:** restore long-term memory slot missing from Cortex migration ([e8f8f0e](https://github.com/Craigtut/animus/commit/e8f8f0e10e173f8c75bcc41f212e7d969c1c099a))
* **heartbeat:** revert LTM slot, add recent messages and wake-up context to ephemeral ([45e422b](https://github.com/Craigtut/animus/commit/45e422b088f48257a4de03d8e6308cd5e88ae3f0))
* **heartbeat:** skip cortex init when no provider configured, fix async schema converter ([21c5270](https://github.com/Craigtut/animus/commit/21c5270cababc8862b543e56dfceb968c512c5c2))
* resolve production build type errors ([2db3bfa](https://github.com/Craigtut/animus/commit/2db3bfa966bdbf996fdfe621cf579c4c70b33351))
* **speech:** add cold-start prefix workaround and voice provider callback ([00047c8](https://github.com/Craigtut/animus/commit/00047c84298960d94ac9c3fce38b33755905968d))
* **tauri:** package dock suppression preload script ([6fb9762](https://github.com/Craigtut/animus/commit/6fb9762092dc1125fd44c406d9511f7725951bf2))
* **tauri:** stop prune from deleting build-output dirs named doc/test ([e2cc620](https://github.com/Craigtut/animus/commit/e2cc62045f08213c850209e35cf83b558e425dea))
* **usage:** correct cache hit rate, tick count, timezone, and chart display ([d8b7da5](https://github.com/Craigtut/animus/commit/d8b7da56549406bd5c3052f0f64a1bb508582692))

## [0.3.3](https://github.com/Craigtut/animus/compare/v0.3.2...v0.3.3) (2026-03-12)

### Features

* **ci:** add prebuilt tts-native binaries with Windows support ([288167e](https://github.com/Craigtut/animus/commit/288167e0a73cf95c151f5e3d9a7c1f8cb2f5b4e2))
* **speech:** add previewVoice tRPC mutation as streaming fallback ([af02b1b](https://github.com/Craigtut/animus/commit/af02b1b117e95da731e078826835f4deb0a0070d))
* **speech:** add streaming TTS voice preview for near-instant playback ([52db0f0](https://github.com/Craigtut/animus/commit/52db0f0788e22b887579d69af8959122d0cb2782))

### Bug Fixes

* **agents:** configure Codex sandbox to prevent shell commands hanging on Windows ([9b71abc](https://github.com/Craigtut/animus/commit/9b71abc6e4394bf704083636d3b05827f8e41e1d))
* **agents:** fix auth provider tests for async session manager and blocking initiateAuth ([e9d88be](https://github.com/Craigtut/animus/commit/e9d88beaa339d379998ee7cdb95f9607c9e5ea27))
* **backend:** correct telemetry version reporting and prevent IP capture ([75ba871](https://github.com/Craigtut/animus/commit/75ba8716d2274011ef2f95e54bb89c744f3d08ed))
* **backend:** fix package signature verification on Windows ([2ad051a](https://github.com/Craigtut/animus/commit/2ad051a3f61a73c0fdd7bd0c593a59143ff501bc))
* **ci:** configure ports.ubuntu.com for ARM64 cross-compilation packages ([ad371f3](https://github.com/Craigtut/animus/commit/ad371f31af761e830d36ab6c489f81c26c9134c3))
* **ci:** fix build failures and add pre-commit/pre-push hooks ([91b50c2](https://github.com/Craigtut/animus/commit/91b50c26ec40ecb1c89c82b1f4e8d376b6218619))
* **ci:** install cross-compilation OpenSSL for Linux ARM64 tts-native build ([bbfc9fa](https://github.com/Craigtut/animus/commit/bbfc9faec8c736c7ec0b0b02ad22a637af78eaa8))
* **ci:** set cross-linker for aarch64-unknown-linux-gnu target ([3245d43](https://github.com/Craigtut/animus/commit/3245d43d85783f278994d319f255533fb673bd0b))
* **ci:** vendor OpenSSL for Linux cross-compilation instead of system packages ([a07bde6](https://github.com/Craigtut/animus/commit/a07bde677f2963221d6b0d750c8e8e74596d9245))
* **frontend:** fix Select dropdown scroll and overflow clipping ([a765938](https://github.com/Craigtut/animus/commit/a765938fda4e01ab855ea6db7b65add8346c9eac))
* **frontend:** normalize Slider neutral calculations to work with any min/max range ([dbf1b66](https://github.com/Craigtut/animus/commit/dbf1b6663553816ae04d54ae141affa77e736434))
* **frontend:** remove auto-restart on update, prompt user to restart manually ([5743bf5](https://github.com/Craigtut/animus/commit/5743bf5793b82fec3d9e9d059010053f61128f98))

### Performance Improvements

* **ci:** split Docker build into native per-arch jobs and use pre-built tts-native binaries ([88ee292](https://github.com/Craigtut/animus/commit/88ee292b21239778f19678353b33fa95eff3a2cb))

## [0.3.2](https://github.com/Craigtut/animus/compare/v0.3.1...v0.3.2) (2026-03-11)

### Features

* **agents:** upgrade Claude Agent SDK to v0.2.x and refactor SDK lifecycle ([b793fc8](https://github.com/Craigtut/animus/commit/b793fc8f2e3c51e0b0e75f37044e6c4ddf1f1e9f))

### Bug Fixes

* **frontend:** websocket auth fix ([bc210bb](https://github.com/Craigtut/animus/commit/bc210bb8de80dcd28b43d05fdb54974365519198))
* **release:** keep changelog header at top when generating entries ([de92133](https://github.com/Craigtut/animus/commit/de921331d18c6124ed7c5d9fc79a965124132086))

## [0.3.1](https://github.com/Craigtut/animus/compare/v0.3.0...v0.3.1) (2026-03-09)

### Bug Fixes

* **ci:** ensure workspace node_modules dirs exist after prune in Docker build ([2409ec2](https://github.com/Craigtut/animus/commit/2409ec26da2ee04af7f74fb77c06988fbbeab550))
* **frontend:** rename max saves label and add Tauri native export dialog ([c891192](https://github.com/Craigtut/animus/commit/c891192206fa301318f1416104ce6a903e0844c3))

## [0.3.0](https://github.com/Craigtut/animus/compare/v0.2.4...v0.3.0) (2026-03-09)

### Features

* **backend:** add automatic save system for AI state ([db832ec](https://github.com/Craigtut/animus/commit/db832ecfa8eb8aca7d66bd47f09a4c06e31019d9))
* **ci:** add Docker image build to release pipeline ([490c1a7](https://github.com/Craigtut/animus/commit/490c1a7a6fb959909a59aaca3478da4ad4c6b65c))
* **frontend:** add context inspector for heartbeat tick prompts ([a04b872](https://github.com/Craigtut/animus/commit/a04b87278137fe6059d9090294180cbf7ec14c0c))
* **tauri:** add desktop auto-update system ([4cba870](https://github.com/Craigtut/animus/commit/4cba8706f2711da000e509e6e66a251b0a735548))

## [0.2.4](https://github.com/Craigtut/animus/compare/v0.2.3...v0.2.4) (2026-03-09)

### Bug Fixes

* **agents:** resolve codex binary in ESM-only SDK packages ([94105aa](https://github.com/Craigtut/animus/commit/94105aacd04a728e79964e85b846833339a44bfa))

## [0.2.3](https://github.com/Craigtut/animus/compare/v0.2.2...v0.2.3) (2026-03-08)

### Features

* **tauri:** runtime SDK installation and WebSocket auth for production builds ([ecbd0e2](https://github.com/Craigtut/animus/commit/ecbd0e25176d4589af0fa0ab9cb437b59972e5d3))

### Bug Fixes

* **backend:** resolve npm spawn EINVAL on Windows for SDK installation ([3ae900a](https://github.com/Craigtut/animus/commit/3ae900a34477e279c5437a423f84d174eba32735))
* **ci:** move platform-specific deps to optionalDependencies ([d5d2c0b](https://github.com/Craigtut/animus/commit/d5d2c0b4f063d45e0b28f4ca28585ce12b1697eb))
* **ci:** preserve Windows backslash paths in release artifact upload ([0ac79d7](https://github.com/Craigtut/animus/commit/0ac79d71fd03edefe39039bd6d3dcff7071470bc))
* **ci:** strip Windows carriage returns from artifact paths ([c52e73b](https://github.com/Craigtut/animus/commit/c52e73b3d6c6a1b819f74871a05c1a47d57bb1ce))
* **deps:** bump swiper, fastify, dompurify, tar for security patches ([9195487](https://github.com/Craigtut/animus/commit/9195487a798ff553f548ba45aae1c5cc5ae44af7))

## [0.2.2](https://github.com/Craigtut/animus/compare/v0.2.1...v0.2.2) (2026-03-07)

### Features

* **tauri:** runtime Claude SDK installation and WebSocket auth for production builds ([ecbd0e2](https://github.com/Craigtut/animus/commit/ecbd0e2))

### Bug Fixes

* **ci:** move platform-specific deps to optionalDependencies ([d5d2c0b](https://github.com/Craigtut/animus/commit/d5d2c0b))
* **release:** fix bump-version entry guard on windows ([1c6acd5](https://github.com/Craigtut/animus/commit/1c6acd5))
* **tauri:** windows production build and runtime fixes ([fa67e84](https://github.com/Craigtut/animus/commit/fa67e84))

## [0.2.1](https://github.com/Craigtut/animus/compare/v0.2.0...v0.2.1) (2026-03-07)

### Features

* **tauri:** add Apple code signing and notarization for macOS builds ([a7247ea](https://github.com/Craigtut/animus/commit/a7247ea3043e867f046120dd7bca143fe389eedf))

### Bug Fixes

* **ci:** pull release notes from CHANGELOG.md into GitHub release ([88ba70c](https://github.com/Craigtut/animus/commit/88ba70c24d13dd68267c6a679fbfbe755ce92016))

## 0.2.0 (2026-03-06)

Initial release of the Animus Engine.

### Highlights

- Heartbeat-driven autonomous agent with continuous inner life (thoughts, emotions, goals)
- Seven SQLite databases for isolated data lifecycles
- Multi-provider agent SDK (Claude, Codex, OpenCode)
- React 19 frontend with presence, mind, people, and settings pages
- Tauri desktop app for macOS and Windows
- Channel system with web chat built in, extensible via channel packages
- Plugin system with skills-first philosophy (7 component types)
- Memory system with local embeddings (Transformers.js + BGE-small-en-v1.5)
- Observational memory with three-stream compression
- Contact system with identity resolution and permission tiers
- Goal and task systems with salience scoring
- Encrypted credential vault (AES-256-GCM, Argon2id)
- Speech engine (Parakeet STT, Pocket TTS) with voice cloning support
- CI/CD pipelines and release automation
