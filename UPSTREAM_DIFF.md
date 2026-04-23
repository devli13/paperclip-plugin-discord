# Upstream diff — proposed pull request content

This document tracks the exact changes this fork introduces on top of [mvanhorn/paperclip-plugin-discord](https://github.com/mvanhorn/paperclip-plugin-discord). It is the basis for the upstream PR.

## Motivation

Upstream's `handleMessageCreate` only routes *replies to prior bot notifications* to Paperclip. For teams using the plugin as a general-purpose Discord community interface, there's no path for:

1. A user @mentioning the bot in a channel and expecting a response.
2. A user DMing the bot.

This fork adds both, gated by new opt-in config fields so default behavior is unchanged for existing installs.

## Changes (4 deltas)

### Delta 1 — `DIRECT_MESSAGES` gateway intent

**File:** `src/gateway.ts`

Added `DIRECT_MESSAGES_INTENT = 4096` constant. Extended `GatewayOptions` with a new optional `listenForDirectMessages?: boolean`. Intent bitmask now OR's in the DM intent when set.

Existing callers that don't set `listenForDirectMessages` are unaffected — defaults to `listenForMessages` which is existing behavior.

### Delta 2 — `MessageCreateEvent` type extensions

**File:** `src/gateway.ts`

Added two optional fields to `MessageCreateEvent` that Discord actually sends but upstream's interface didn't expose:

- `guild_id?: string | null` — omitted by Discord for DM messages.
- `mentions?: Array<{ id, username, bot? }>` — list of users mentioned in the message.

Both fields are already populated by Discord in real events; upstream just wasn't surfacing them to handlers.

### Delta 3 — Free-form @mention and DM routing

**File:** `src/worker.ts` (handler rewrite)

`handleMessageCreate` now detects:

- `!message.guild_id` → DM. If `config.enableDirectMessages` is on and a `dmAgentId` (or `mentionAgentId` fallback) is configured, route to `ctx.agents.invoke(agent, company, { prompt, reason })`.
- `message.mentions` contains the bot's user ID → mention. If `config.enableFreeFormMentions` is on, same flow.

Existing reply-to-notification code path runs only when neither branch hits, so behavior for replies is identical to upstream.

### Delta 4 — Serialized per-context message queue

**New file:** `src/message-queue.ts`

In-memory Map<`"guildId:channelId"`, queue>. Only one agent run runs at a time per context. Subsequent messages are enqueued and drained in order. Stale entries (>N seconds old) are dropped before processing. Queue capacity caps out at `messageQueueMaxDepth` (default 10).

Used by `handleMessageCreate` when routing mentions or DMs. Not used for upstream reply-to-notification flow.

### Delta 5 — Config field additions

**File:** `src/constants.ts` (`DEFAULT_CONFIG`) and `src/worker.ts` (`DiscordConfig`)

New optional fields, all defaulting to values that preserve existing behavior:

```ts
enableFreeFormMentions?: boolean;       // default false
enableDirectMessages?: boolean;         // default false
mentionAgentId?: string;                // default ""
dmAgentId?: string;                     // default "" (falls back to mentionAgentId)
mentionCompanyId?: string;              // default "" (falls back to guild→company resolution)
messageQueueMaxDepth?: number;          // default 10
messageQueueStaleSeconds?: number;      // default 600
```

## Tests

All 447 upstream tests pass unchanged with these additions applied. No upstream test assertions were modified.

## Backwards compatibility

Every change is additive:

- New gateway intent is off by default (only requested when `listenForDirectMessages` option passes through as `true`).
- New handler branches only execute when new config flags are explicitly enabled.
- New file (`message-queue.ts`) is only imported and used when new flags are enabled.
- New config fields are all optional with conservative defaults.

Existing installs upgrading from upstream v0.9.0 to this fork see no behavior change unless they opt in.

## License

All modifications are MIT, matching upstream. @mvanhorn retains credit for all pre-fork code.
