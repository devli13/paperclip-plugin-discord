import { describe, it, expect, vi, beforeEach } from "vitest";
import { enqueueForContext, contextKey, queueDepth } from "../src/message-queue.js";

function makeCtx() {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  } as any;
}

describe("message-queue", () => {
  describe("contextKey", () => {
    it("combines guild + channel", () => {
      expect(contextKey("guild-1", "channel-1")).toBe("guild-1:channel-1");
    });
    it("handles null guild as dm", () => {
      expect(contextKey(null, "channel-1")).toBe("dm:channel-1");
      expect(contextKey(undefined, "channel-1")).toBe("dm:channel-1");
    });
  });

  describe("enqueueForContext", () => {
    beforeEach(() => {
      // queueDepth is visible across tests; pick unique keys per test.
    });

    it("runs immediately when queue is empty", async () => {
      const ctx = makeCtx();
      const ran: string[] = [];
      const result = await enqueueForContext(
        ctx,
        "test-empty-" + Math.random(),
        { id: "a", enqueuedAt: Date.now(), run: async () => { ran.push("a"); } },
      );
      expect(result).toBe("running");
      // drain is fire-and-forget; give it a tick to complete.
      await new Promise((r) => setTimeout(r, 20));
      expect(ran).toEqual(["a"]);
    });

    it("processes items in FIFO order", async () => {
      const ctx = makeCtx();
      const key = "test-fifo-" + Math.random();
      const ran: string[] = [];
      const makeItem = (id: string) => ({
        id,
        enqueuedAt: Date.now(),
        run: async () => {
          await new Promise((r) => setTimeout(r, 10));
          ran.push(id);
        },
      });
      await enqueueForContext(ctx, key, makeItem("a"));
      await enqueueForContext(ctx, key, makeItem("b"));
      await enqueueForContext(ctx, key, makeItem("c"));
      await new Promise((r) => setTimeout(r, 100));
      expect(ran).toEqual(["a", "b", "c"]);
    });

    it("rejects when queue is at maxDepth", async () => {
      const ctx = makeCtx();
      const key = "test-depth-" + Math.random();
      // maxDepth=1 means: one item may be pending in the queue (separate
      // from whatever's currently running).
      // First item starts running → shifts off pending → pending=[]
      await enqueueForContext(ctx, key, {
        id: "blocker",
        enqueuedAt: Date.now(),
        run: () => new Promise(() => { /* hangs */ }),
      }, { maxDepth: 1 });
      // Second fills the pending slot.
      await enqueueForContext(ctx, key, {
        id: "second",
        enqueuedAt: Date.now(),
        run: async () => {},
      }, { maxDepth: 1 });
      // Third can't fit; pending.length (1) >= maxDepth (1).
      const third = await enqueueForContext(ctx, key, {
        id: "third",
        enqueuedAt: Date.now(),
        run: async () => {},
      }, { maxDepth: 1 });
      expect(third).toBe("rejected-full");
    });

    it("drops pre-enqueue stale items", async () => {
      const ctx = makeCtx();
      const key = "test-stale-pre-" + Math.random();
      const ran: string[] = [];
      await enqueueForContext(ctx, key, {
        id: "blocker",
        enqueuedAt: Date.now(),
        run: () => new Promise((r) => setTimeout(() => { ran.push("blocker"); r(undefined); }, 50)),
      }, { staleSeconds: 1 });
      // This one is already stale when we enqueue it.
      await enqueueForContext(ctx, key, {
        id: "stale",
        enqueuedAt: Date.now() - 10_000,
        run: async () => { ran.push("stale"); },
      }, { staleSeconds: 1 });
      await new Promise((r) => setTimeout(r, 200));
      expect(ran).toContain("blocker");
      expect(ran).not.toContain("stale");
    });

    it("drops stale items at drain time (Phase 5 M1)", async () => {
      const ctx = makeCtx();
      const key = "test-stale-drain-" + Math.random();
      const ran: string[] = [];
      // Blocker takes 100ms; second item is fresh at enqueue but will be
      // stale by the time drain gets to it (staleSeconds = 0.05 = 50ms).
      await enqueueForContext(ctx, key, {
        id: "blocker",
        enqueuedAt: Date.now(),
        run: () => new Promise((r) => setTimeout(() => { ran.push("blocker"); r(undefined); }, 120)),
      }, { staleSeconds: 0.05 });
      await enqueueForContext(ctx, key, {
        id: "will-go-stale",
        enqueuedAt: Date.now(),
        run: async () => { ran.push("will-go-stale"); },
      }, { staleSeconds: 0.05 });
      await new Promise((r) => setTimeout(r, 300));
      expect(ran).toEqual(["blocker"]);
    });

    it("continues draining after one item throws", async () => {
      const ctx = makeCtx();
      const key = "test-error-" + Math.random();
      const ran: string[] = [];
      await enqueueForContext(ctx, key, {
        id: "boom",
        enqueuedAt: Date.now(),
        run: async () => { throw new Error("boom"); },
      });
      await enqueueForContext(ctx, key, {
        id: "survivor",
        enqueuedAt: Date.now(),
        run: async () => { ran.push("survivor"); },
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(ran).toEqual(["survivor"]);
      expect(ctx.logger.error).toHaveBeenCalled();
    });

    it("queueDepth reports pending items", async () => {
      const ctx = makeCtx();
      const key = "test-depth-observe-" + Math.random();
      await enqueueForContext(ctx, key, {
        id: "blocker",
        enqueuedAt: Date.now(),
        run: () => new Promise(() => {}),
      });
      await enqueueForContext(ctx, key, {
        id: "waiter",
        enqueuedAt: Date.now(),
        run: async () => {},
      });
      // One running (shifted off), one waiting.
      expect(queueDepth(key)).toBe(1);
    });
  });
});
