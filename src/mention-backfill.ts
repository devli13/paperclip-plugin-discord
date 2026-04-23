// devli13 fork — Delta 5: backfill mentions missed during downtime.
//
// On Gateway `ready` (fires on startup AND reconnect), sweep configured
// channels for messages that @mention the bot but have no threaded-reply
// from the bot yet. Enqueue any unaddressed mention through the same
// per-context serialized queue as live events.
//
// "Addressed" detection (strict):
//   A bot message exists later in the channel whose `message_reference.message_id`
//   equals the mention's message ID. A bare bot message in the same channel
//   does NOT count as addressed.
//
// This is the strict interpretation: Ralph must use `reply_to_message_id`
// when responding to a mention. routeToAgent's prompt now asks him to do so,
// and Ralph's AGENTS.md confirms the convention.
//
// Also tracks `processed_mention_ids` in plugin state so reconnects do not
// double-fire for mentions that were routed but where Ralph chose not to
// reply-thread (edge case: he hit an error, or decided the mention didn't
// warrant a response).

import type { PluginContext } from "@paperclipai/plugin-sdk";
import { DISCORD_API_BASE } from "./constants.js";
import { contextKey } from "./message-queue.js";

interface BackfillMessage {
  id: string;
  channel_id: string;
  guild_id?: string | null;
  content: string;
  timestamp: string;
  author: { id: string; username: string; bot?: boolean };
  mentions?: Array<{ id: string; username: string; bot?: boolean }>;
  message_reference?: {
    message_id: string;
    channel_id?: string;
    guild_id?: string;
  };
}

interface BackfillMessageResult {
  message: BackfillMessage;
  channelId: string;
  guildId: string;
}

export interface BackfillOptions {
  botUserId: string;
  botToken: string;
  guildId: string;
  /** Channels to scan. Empty array = scan every text channel in the guild. */
  channelIds: string[];
  /** Don't go back further than this many hours. Default 24. */
  maxHours: number;
  /** Maximum messages to fetch per channel. Safety cap. */
  maxMessagesPerChannel: number;
  /** Fallback channel if guild listing fails (e.g. transient 403). */
  fallbackChannelId?: string;
  /** Callback that enqueues a missed mention for routing. */
  enqueue: (message: BackfillMessage) => Promise<void>;
}

const STATE_KEY_SEEN = (guildId: string, channelId: string): string =>
  `backfill_seen_${guildId}_${channelId}`;

// devli13 fork — M2 fix. Previously a single `backfill_processed_ids_v1`
// array was read-modify-written, creating lost-update races between live
// routing and backfill sweeps. Replaced with per-ID keys (`backfill_processed_<id>`)
// so each write is atomic at the state-store level. We also moved the
// hot-path claim for live/backfill deduplication to `mention_claim_<id>`
// keys (see claimMessageForRouting).
const STATE_KEY_PROCESSED_PREFIX = "backfill_processed_";

async function discordApi(
  ctx: PluginContext,
  token: string,
  path: string,
): Promise<unknown> {
  const res = await fetch(`${DISCORD_API_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent":
        "DiscordBot (https://github.com/devli13/paperclip-plugin-discord, 0.9.1)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as { retry_after?: number };
    const wait = Math.max(500, Math.min(15_000, (body.retry_after ?? 1) * 1000));
    ctx.logger.warn("[backfill] rate limited, sleeping", { waitMs: wait, path });
    await new Promise((r) => setTimeout(r, wait));
    return discordApi(ctx, token, path);
  }
  if (!res.ok) {
    ctx.logger.warn("[backfill] Discord API error", { status: res.status, path });
    return null;
  }
  return res.json();
}

function snowflakeToMs(id: string): number {
  return Number(BigInt(id) >> 22n) + 1420070400000;
}

async function fetchChannelMessagesAfter(
  ctx: PluginContext,
  token: string,
  channelId: string,
  afterId: string | null,
  max: number,
  cutoffMs: number,
): Promise<BackfillMessage[]> {
  // devli13 fork — Phase 3 bug fix. Previously, on cold start (afterId=null)
  // this function fetched the most recent 100 messages and watermarked past
  // any older unseen mentions. If the bot was offline during a busy period
  // longer than 100 messages, those mentions were silently skipped forever.
  //
  // New behavior:
  //   - If watermark exists: forward-paginate with `after` as before.
  //   - If no watermark: backward-paginate with `before`, collecting until
  //     we hit the cutoff time or max-per-channel cap. Then sort oldest-first.
  if (afterId) {
    return fetchForward(ctx, token, channelId, afterId, max);
  }
  return fetchBackwardUntilCutoff(ctx, token, channelId, max, cutoffMs);
}

async function fetchForward(
  ctx: PluginContext,
  token: string,
  channelId: string,
  afterId: string,
  max: number,
): Promise<BackfillMessage[]> {
  const all: BackfillMessage[] = [];
  let cursor: string = afterId;
  while (all.length < max) {
    const take = Math.min(100, max - all.length);
    const qs = new URLSearchParams({ limit: String(take), after: cursor });
    const data = (await discordApi(
      ctx,
      token,
      `/channels/${channelId}/messages?${qs.toString()}`,
    )) as BackfillMessage[] | null;
    if (!data || data.length === 0) break;
    const sorted = [...data].sort((a, b) => a.id.localeCompare(b.id));
    for (const m of sorted) all.push(m);
    if (data.length < take) break;
    cursor = sorted[sorted.length - 1].id;
  }
  return all;
}

async function fetchBackwardUntilCutoff(
  ctx: PluginContext,
  token: string,
  channelId: string,
  max: number,
  cutoffMs: number,
): Promise<BackfillMessage[]> {
  // Paginate newest→oldest with `before`, stop when we hit the cutoff or max.
  const all: BackfillMessage[] = [];
  let cursor: string | null = null;
  while (all.length < max) {
    const take = Math.min(100, max - all.length);
    const qs = new URLSearchParams({ limit: String(take) });
    if (cursor) qs.set("before", cursor);
    const data = (await discordApi(
      ctx,
      token,
      `/channels/${channelId}/messages?${qs.toString()}`,
    )) as BackfillMessage[] | null;
    if (!data || data.length === 0) break;
    // Discord returns newest-first. Each page is newer→older.
    for (const m of data) all.push(m);
    const oldestInPage = data[data.length - 1];
    cursor = oldestInPage.id;
    if (snowflakeToMs(oldestInPage.id) < cutoffMs) break;
    if (data.length < take) break;
  }
  // Sort oldest→newest for the caller (so the mention processing order matches
  // real chronology: earliest missed mention processed first).
  all.sort((a, b) => a.id.localeCompare(b.id));
  return all;
}

async function isProcessed(ctx: PluginContext, messageId: string): Promise<boolean> {
  const v = await ctx.state.get({
    scopeKind: "instance",
    stateKey: `${STATE_KEY_PROCESSED_PREFIX}${messageId}`,
  });
  return v != null;
}

async function setProcessed(ctx: PluginContext, messageId: string): Promise<void> {
  await ctx.state.set(
    { scopeKind: "instance", stateKey: `${STATE_KEY_PROCESSED_PREFIX}${messageId}` },
    { processedAt: Date.now() },
  );
}

export async function markProcessed(
  ctx: PluginContext,
  messageId: string,
): Promise<void> {
  await setProcessed(ctx, messageId);
  // Also write the per-ID claim key so the live/backfill race has a fast check.
  await ctx.state.set(
    { scopeKind: "instance", stateKey: `mention_claim_${messageId}` },
    { claimedAt: Date.now() },
  );
}

/**
 * Atomic "claim" of a message for routing. Returns true if this caller wins
 * the claim (go ahead and route), false if another path (live or backfill)
 * has already claimed it (skip).
 *
 * This closes the live-vs-backfill double-routing race codex flagged: if a
 * user mentions the bot while a backfill sweep is running, only one of the
 * two paths will actually invoke the agent.
 */
export async function claimMessageForRouting(
  ctx: PluginContext,
  messageId: string,
): Promise<boolean> {
  const key = `mention_claim_${messageId}`;
  const existing = await ctx.state.get({ scopeKind: "instance", stateKey: key });
  if (existing) return false;
  await ctx.state.set({ scopeKind: "instance", stateKey: key }, { claimedAt: Date.now() });
  return true;
}

/**
 * Scan configured channels for unaddressed @mentions and enqueue them through
 * the caller-provided `enqueue` function.
 *
 * Returns count of messages enqueued.
 */
export async function backfillMissedMentions(
  ctx: PluginContext,
  options: BackfillOptions,
): Promise<{ scanned: number; enqueued: number; skipped: number }> {
  const { botUserId, botToken, guildId, maxHours, maxMessagesPerChannel, enqueue } =
    options;

  // Resolve channels to scan.
  let channels = options.channelIds;
  if (channels.length === 0) {
    const raw = (await discordApi(ctx, botToken, `/guilds/${guildId}/channels`)) as
      | Array<{ id: string; type: number }>
      | null;
    if (!raw) {
      if (options.fallbackChannelId) {
        ctx.logger.warn(
          "[backfill] could not list guild channels — falling back to single channel",
          { fallbackChannelId: options.fallbackChannelId },
        );
        channels = [options.fallbackChannelId];
      } else {
        ctx.logger.warn("[backfill] could not list guild channels and no fallback set");
        return { scanned: 0, enqueued: 0, skipped: 0 };
      }
    } else {
      // type 0 = GUILD_TEXT; type 5 = GUILD_ANNOUNCEMENT
      channels = raw.filter((c) => c.type === 0 || c.type === 5).map((c) => c.id);
    }
  }

  const cutoffMs = Date.now() - maxHours * 60 * 60 * 1000;

  let totalScanned = 0;
  let totalEnqueued = 0;
  let totalSkipped = 0;

  for (const channelId of channels) {
    const seenKey = STATE_KEY_SEEN(guildId, channelId);
    const afterId = (await ctx.state.get({ scopeKind: "instance", stateKey: seenKey })) as
      | string
      | null;

    let messages: BackfillMessage[];
    try {
      messages = await fetchChannelMessagesAfter(
        ctx,
        botToken,
        channelId,
        afterId ?? null,
        maxMessagesPerChannel,
        cutoffMs,
      );
    } catch (err) {
      ctx.logger.warn("[backfill] fetch failed for channel", {
        channelId,
        error: String(err),
      });
      continue;
    }

    totalScanned += messages.length;
    if (messages.length === 0) continue;

    // Apply cutoff: skip anything older than maxHours. (Cold-start backward
    // pagination already stops at cutoff, but the forward path might include
    // anything ≥ the old watermark, so re-filter defensively.)
    const eligible = messages.filter((m) => snowflakeToMs(m.id) >= cutoffMs);

    // Build set of message IDs that have an explicit bot reply.
    const addressed = new Set<string>();
    for (const m of eligible) {
      if (
        m.author.id === botUserId &&
        m.message_reference?.message_id
      ) {
        addressed.add(m.message_reference.message_id);
      }
    }

    // Find unaddressed bot mentions.
    for (const m of eligible) {
      if (m.author.bot || m.author.id === botUserId) continue;
      const mentionsBot = (m.mentions ?? []).some((u) => u.id === botUserId);
      if (!mentionsBot) continue;
      if (await isProcessed(ctx, m.id)) {
        totalSkipped++;
        continue;
      }
      if (addressed.has(m.id)) {
        // Strict: has a reply-referenced bot response. Treat as handled.
        await setProcessed(ctx, m.id); // cache so we skip quickly next time
        totalSkipped++;
        continue;
      }
      // devli13 fork — atomic claim. If live gateway already routed this
      // message while we were scanning, the claim fails and we skip.
      const claimed = await claimMessageForRouting(ctx, m.id);
      if (!claimed) {
        ctx.logger.info("[backfill] message already claimed by live path", {
          messageId: m.id,
        });
        await setProcessed(ctx, m.id);
        totalSkipped++;
        continue;
      }
      try {
        await enqueue(m);
        await setProcessed(ctx, m.id);
        totalEnqueued++;
      } catch (err) {
        ctx.logger.warn("[backfill] enqueue failed", {
          messageId: m.id,
          error: String(err),
        });
      }
    }

    // Persist watermark to the most recent message we saw in this channel.
    if (messages.length > 0) {
      const latest = messages[messages.length - 1].id;
      await ctx.state.set({ scopeKind: "instance", stateKey: seenKey }, latest);
    }
  }

  ctx.logger.info("[backfill] scan complete", {
    scanned: totalScanned,
    enqueued: totalEnqueued,
    skipped: totalSkipped,
    channels: channels.length,
  });

  return { scanned: totalScanned, enqueued: totalEnqueued, skipped: totalSkipped };
}

// Re-exported for worker.ts.
export { contextKey };
