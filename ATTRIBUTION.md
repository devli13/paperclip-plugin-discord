# Attribution

## Upstream

This package is a fork of **[paperclip-plugin-discord](https://github.com/mvanhorn/paperclip-plugin-discord) by [@mvanhorn](https://github.com/mvanhorn)** (MIT). All of the original work — Gateway handling, intelligence signal extraction, tridaily digest, HITL escalation, ACP thread spawning, slash commands, media pipeline, workflow engine — is preserved. This fork only *adds* functionality; it does not rewrite or remove upstream behavior.

## What this fork adds (vs upstream v0.9.0)

1. **`DIRECT_MESSAGES` gateway intent** — upstream only subscribed to `GUILDS | GUILD_MESSAGES | MESSAGE_CONTENT`, so bots could not receive DMs. This fork adds the `DIRECT_MESSAGES` (value 4096) intent when `enableDirectMessages` is on.

2. **Free-form @mention routing** — upstream's `handleMessageCreate` only processed replies to prior bot notifications. This fork, when `enableFreeFormMentions` is on, also routes any channel message where the bot is @mentioned to an agent invoke. The upstream reply-to-notification path is preserved unchanged.

3. **Serialized per-context message queue** (new file: `src/message-queue.ts`) — one agent run in flight per `(guild_id, channel_id)`. Additional inbound messages are queued and processed in order after the prior run completes. Burst traffic gets deterministic FIFO ordering instead of coalescing or parallelism.

4. **`DiscordConfig` extensions** — new optional fields `enableFreeFormMentions`, `enableDirectMessages`, `mentionAgentId`, `dmAgentId`, `mentionCompanyId`, `messageQueueMaxDepth`, `messageQueueStaleSeconds`. All defaults preserve upstream behavior.

5. **Downtime mention backfill** (new file: `src/mention-backfill.ts`) — on plugin activation, sweep channels for @mentions missed while the bot was offline. Strict detection: only treats a mention as addressed if there's a `message_reference`-linked bot reply after it. Bounded lookback via `backfillMaxHours` (default 24h). Two-layer dedup (per-channel watermark + global processed-set).

See [UPSTREAM_DIFF.md](./UPSTREAM_DIFF.md) for the exact line-by-line diff intended for the upstream pull request.

## Upstream PR

We intend to file a pull request against @mvanhorn's repo proposing these additions. If accepted, this fork will be deprecated in favor of upstream. If not, it stays maintained here.

File any issues here first: <https://github.com/devli13/paperclip-plugin-discord/issues>. Upstream-relevant issues will be forwarded.

## Dependencies

- [`@paperclipai/plugin-sdk`](https://www.npmjs.com/package/@paperclipai/plugin-sdk) (peer) — Paperclip plugin runtime.
- [`@paperclipai/shared`](https://www.npmjs.com/package/@paperclipai/shared) (peer).

## Companion project

See [`@devli13/mcp-discord`](https://github.com/devli13/mcp-discord) — a standalone MCP server for Discord REST operations. Works with Claude Code, Gemini CLI, and Paperclip agents.

## License

MIT — same as upstream. See [LICENSE](./LICENSE).
