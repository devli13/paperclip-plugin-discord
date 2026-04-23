import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  backfillMissedMentions,
  markProcessed,
  claimMessageForRouting,
} from "../src/mention-backfill.js";

// In-memory fake for ctx.state and ctx.logger. Matches the PluginContext shape
// closely enough for backfill's usage.
function makeCtx() {
  const store = new Map<string, unknown>();
  return {
    state: {
      get: vi.fn(async (req: { stateKey: string }) => store.get(req.stateKey) ?? null),
      set: vi.fn(async (req: { stateKey: string }, value: unknown) => {
        store.set(req.stateKey, value);
      }),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    __store: store,
  } as any;
}

// Build a Discord message payload that mentions the bot.
function makeMessage(
  id: string,
  opts: {
    botUserId: string;
    authorId?: string;
    botAuthor?: boolean;
    mentionsBot?: boolean;
    replyToMessageId?: string;
    content?: string;
  },
) {
  return {
    id,
    channel_id: "ch-1",
    guild_id: "g-1",
    content: opts.content ?? `<@${opts.botUserId}> hey`,
    author: {
      id: opts.authorId ?? "user-1",
      username: "user1",
      bot: opts.botAuthor ?? false,
    },
    mentions: opts.mentionsBot === false ? [] : [{ id: opts.botUserId, username: "bot" }],
    message_reference: opts.replyToMessageId
      ? { message_id: opts.replyToMessageId, channel_id: "ch-1" }
      : undefined,
    timestamp: new Date().toISOString(),
  };
}

const BOT = "1000000000000000000"; // valid snowflake shape

// Build synthetic snowflake IDs with embedded timestamps so cutoff filtering
// can be exercised.
function snowflakeAtMs(ms: number): string {
  const DISCORD_EPOCH = 1420070400000;
  return String((BigInt(ms - DISCORD_EPOCH) << 22n) | BigInt(Math.floor(Math.random() * 0xffff)));
}

describe("mention-backfill", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("claimMessageForRouting", () => {
    it("first caller wins, second loses", async () => {
      const ctx = makeCtx();
      const first = await claimMessageForRouting(ctx, "msg-1");
      const second = await claimMessageForRouting(ctx, "msg-1");
      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it("different ids don't interfere", async () => {
      const ctx = makeCtx();
      const a = await claimMessageForRouting(ctx, "msg-a");
      const b = await claimMessageForRouting(ctx, "msg-b");
      expect(a).toBe(true);
      expect(b).toBe(true);
    });
  });

  describe("markProcessed", () => {
    it("sets both processed and claim keys", async () => {
      const ctx = makeCtx();
      await markProcessed(ctx, "msg-1");
      expect(ctx.__store.get("backfill_processed_msg-1")).toBeDefined();
      expect(ctx.__store.get("mention_claim_msg-1")).toBeDefined();
    });
  });

  describe("backfillMissedMentions", () => {
    it("returns zero when Discord returns no channels and no fallback set", async () => {
      const ctx = makeCtx();
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Unknown Guild", code: 10004 }), { status: 404 }),
      );
      const enqueue = vi.fn(async () => {});
      const result = await backfillMissedMentions(ctx, {
        botUserId: BOT,
        botToken: "tok",
        guildId: "g-1",
        channelIds: [],
        maxHours: 24,
        maxMessagesPerChannel: 100,
        enqueue,
      });
      expect(result).toEqual({ scanned: 0, enqueued: 0, skipped: 0 });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("uses fallback channel when guild listing fails and fallback is set", async () => {
      const ctx = makeCtx();
      // First fetch: guild channels — 403. Second: channel messages — returns an unaddressed mention.
      const recentMsgId = snowflakeAtMs(Date.now() - 60_000);
      const messages = [makeMessage(recentMsgId, { botUserId: BOT })];
      let call = 0;
      global.fetch = vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) {
          return new Response(JSON.stringify({ message: "Forbidden" }), { status: 403 });
        }
        return new Response(JSON.stringify(messages), { status: 200 });
      });
      const enqueued: string[] = [];
      const result = await backfillMissedMentions(ctx, {
        botUserId: BOT,
        botToken: "tok",
        guildId: "g-1",
        channelIds: [],
        maxHours: 24,
        maxMessagesPerChannel: 50,
        fallbackChannelId: "ch-1",
        enqueue: async (m) => { enqueued.push(m.id); },
      });
      expect(result.enqueued).toBe(1);
      expect(enqueued).toEqual([recentMsgId]);
    });

    it("skips mentions already marked processed", async () => {
      const ctx = makeCtx();
      const recentMsgId = snowflakeAtMs(Date.now() - 60_000);
      // Pre-mark as processed.
      await markProcessed(ctx, recentMsgId);
      const messages = [makeMessage(recentMsgId, { botUserId: BOT })];
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(messages), { status: 200 }),
      );
      const enqueue = vi.fn(async () => {});
      const result = await backfillMissedMentions(ctx, {
        botUserId: BOT,
        botToken: "tok",
        guildId: "g-1",
        channelIds: ["ch-1"],
        maxHours: 24,
        maxMessagesPerChannel: 50,
        enqueue,
      });
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it("skips mentions with strict-addressed bot reply via message_reference", async () => {
      const ctx = makeCtx();
      const mentionId = snowflakeAtMs(Date.now() - 120_000);
      const replyId = snowflakeAtMs(Date.now() - 60_000);
      const messages = [
        makeMessage(mentionId, { botUserId: BOT, authorId: "user-1" }),
        // Bot's reply references the mention.
        makeMessage(replyId, {
          botUserId: BOT,
          authorId: BOT,
          botAuthor: true,
          mentionsBot: false,
          replyToMessageId: mentionId,
        }),
      ];
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(messages), { status: 200 }),
      );
      const enqueue = vi.fn(async () => {});
      const result = await backfillMissedMentions(ctx, {
        botUserId: BOT,
        botToken: "tok",
        guildId: "g-1",
        channelIds: ["ch-1"],
        maxHours: 24,
        maxMessagesPerChannel: 50,
        enqueue,
      });
      expect(enqueue).not.toHaveBeenCalled();
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    });

    it("does NOT skip mention when bot posted a reply that does not reference it", async () => {
      // Strict detector: bare bot message in channel does not count as addressed.
      const ctx = makeCtx();
      const mentionId = snowflakeAtMs(Date.now() - 120_000);
      const bareReplyId = snowflakeAtMs(Date.now() - 60_000);
      const messages = [
        makeMessage(mentionId, { botUserId: BOT }),
        // Bot posted but did NOT reply-reference the mention.
        makeMessage(bareReplyId, {
          botUserId: BOT,
          authorId: BOT,
          botAuthor: true,
          mentionsBot: false,
        }),
      ];
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(messages), { status: 200 }),
      );
      const enqueue = vi.fn(async () => {});
      const result = await backfillMissedMentions(ctx, {
        botUserId: BOT,
        botToken: "tok",
        guildId: "g-1",
        channelIds: ["ch-1"],
        maxHours: 24,
        maxMessagesPerChannel: 50,
        enqueue,
      });
      expect(result.enqueued).toBe(1);
    });

    it("respects maxHours cutoff", async () => {
      const ctx = makeCtx();
      const oldMsgId = snowflakeAtMs(Date.now() - 48 * 60 * 60 * 1000); // 48h ago
      const messages = [makeMessage(oldMsgId, { botUserId: BOT })];
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(messages), { status: 200 }),
      );
      const enqueue = vi.fn(async () => {});
      const result = await backfillMissedMentions(ctx, {
        botUserId: BOT,
        botToken: "tok",
        guildId: "g-1",
        channelIds: ["ch-1"],
        maxHours: 24,
        maxMessagesPerChannel: 50,
        enqueue,
      });
      expect(enqueue).not.toHaveBeenCalled();
      expect(result.enqueued).toBe(0);
    });

    it("atomic claim prevents double-enqueue when live path races", async () => {
      const ctx = makeCtx();
      const recentMsgId = snowflakeAtMs(Date.now() - 60_000);
      // Simulate the live path having already claimed this message.
      await claimMessageForRouting(ctx, recentMsgId);
      const messages = [makeMessage(recentMsgId, { botUserId: BOT })];
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(messages), { status: 200 }),
      );
      const enqueue = vi.fn(async () => {});
      const result = await backfillMissedMentions(ctx, {
        botUserId: BOT,
        botToken: "tok",
        guildId: "g-1",
        channelIds: ["ch-1"],
        maxHours: 24,
        maxMessagesPerChannel: 50,
        enqueue,
      });
      expect(enqueue).not.toHaveBeenCalled();
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    });
  });
});
