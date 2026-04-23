// devli13 fork — per-context serialized message queue.
//
// Ensures only one agent run is in flight per (guild_id, channel_id). Additional
// messages arriving while a run is active are enqueued and processed in order
// after the prior run completes.
//
// Liam's preference: serialize, don't coalesce. Slower under burst, but every
// message gets its own deterministic response and the UX is unambiguous.

import type { PluginContext } from "@paperclipai/plugin-sdk";

interface QueuedItem {
  id: string; // usually the message_id
  enqueuedAt: number;
  run: () => Promise<void>;
}

interface Queue {
  items: QueuedItem[];
  running: boolean;
}

const queues = new Map<string, Queue>();

export function contextKey(guildId: string | null | undefined, channelId: string): string {
  return `${guildId ?? "dm"}:${channelId}`;
}

export interface EnqueueOptions {
  maxDepth?: number;
  staleSeconds?: number;
}

/**
 * Enqueue a job for the given context. Returns "enqueued" (will run when its
 * turn comes), "rejected-full" (queue is at max depth), or "running" (started
 * immediately because the queue was empty).
 */
export async function enqueueForContext(
  ctx: PluginContext,
  key: string,
  item: QueuedItem,
  options: EnqueueOptions = {},
): Promise<"enqueued" | "rejected-full" | "running"> {
  const maxDepth = options.maxDepth ?? 10;
  let q = queues.get(key);
  if (!q) {
    q = { items: [], running: false };
    queues.set(key, q);
  }

  // Drop stale items. Prevents old queued mentions from waking the bot after
  // the user has already moved on.
  if (options.staleSeconds && q.items.length > 0) {
    const cutoff = Date.now() - options.staleSeconds * 1000;
    q.items = q.items.filter((it) => it.enqueuedAt >= cutoff);
  }

  if (q.items.length >= maxDepth) {
    ctx.logger.warn("[message-queue] dropping message — queue full", { key, maxDepth });
    return "rejected-full";
  }

  q.items.push(item);

  if (!q.running) {
    // Kick off drain. Do not await — this is fire-and-forget so the caller
    // can return control to Gateway.
    drain(ctx, key).catch((err) => {
      ctx.logger.error("[message-queue] drain failed", { key, error: String(err) });
    });
    return "running";
  }

  return "enqueued";
}

async function drain(ctx: PluginContext, key: string): Promise<void> {
  const q = queues.get(key);
  if (!q || q.running) return;
  q.running = true;
  try {
    while (q.items.length > 0) {
      const next = q.items.shift()!;
      try {
        await next.run();
      } catch (err) {
        ctx.logger.error("[message-queue] item failed", { key, id: next.id, error: String(err) });
      }
    }
  } finally {
    q.running = false;
    // Clean up empty queue to avoid unbounded map growth across many ephemeral
    // DMs / channels the bot interacts with.
    if (q.items.length === 0) queues.delete(key);
  }
}

/** For tests / observability. */
export function queueDepth(key: string): number {
  return queues.get(key)?.items.length ?? 0;
}
