import { describe, it, expect, beforeEach } from "vitest";
import {
  checkIdempotency,
  clearPendingIdempotency,
  hashIdempotencyRequest,
  isStrongIdempotencyKey,
  saveIdempotentResponse,
} from "../src/idempotency.js";

const REQUEST_HASH = "a".repeat(64);

const state: {
  isFirstInsert: boolean;
  rows: Array<{ responseJson: string; requestHash?: string; resourceId?: string }>;
  reclaimedRowsAffected: number;
  savedRowsAffected: number;
  deleted: number;
  inserted: Array<Record<string, unknown>>;
} = {
  isFirstInsert: true,
  rows: [],
  reclaimedRowsAffected: 0,
  savedRowsAffected: 1,
  deleted: 0,
  inserted: [],
};

function createMockDb() {
  return {
    select: (_cols?: unknown) => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              state.rows.map((row) => ({
                requestHash: row.requestHash ?? REQUEST_HASH,
                resourceId: row.resourceId ?? "",
                ...row,
              })),
            ),
        }),
      }),
    }),
    insert: () => ({
      values: (data: Record<string, unknown>) => {
        state.inserted.push(data);
        return {
          onConflictDoNothing: () => {
            const result = state.isFirstInsert ? [{ responseJson: "__pending__" }] : [];
            return {
              returning: () => Promise.resolve(result),
            };
          },
        };
      },
    }),
    update: () => ({
      set: (data: Record<string, unknown>) => ({
        where: () =>
          Promise.resolve({
            rowsAffected:
              "responseJson" in data ? state.savedRowsAffected : state.reclaimedRowsAffected,
          }),
      }),
    }),
    delete: () => ({
      where: () => {
        state.deleted += 1;
        return Promise.resolve({ rowsAffected: 1 });
      },
    }),
  };
}

function reset() {
  state.isFirstInsert = true;
  state.rows = [];
  state.reclaimedRowsAffected = 0;
  state.savedRowsAffected = 1;
  state.deleted = 0;
  state.inserted = [];
}

describe("isStrongIdempotencyKey / hashIdempotencyRequest", () => {
  it("accepts UUID and long random tokens", () => {
    expect(isStrongIdempotencyKey("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isStrongIdempotencyKey("x".repeat(32))).toBe(true);
    expect(isStrongIdempotencyKey("short")).toBe(false);
  });

  it("hashes canonicalized objects stably", async () => {
    const a = await hashIdempotencyRequest({ b: 1, a: 2 });
    const b = await hashIdempotencyRequest({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });
});

describe("checkIdempotency", () => {
  beforeEach(reset);

  it("first insert proceeds with leaseVersion", async () => {
    const result = await checkIdempotency(createMockDb() as never, "k1", "pay", REQUEST_HASH);
    expect(result.shouldProceed).toBe(true);
    expect(result.cachedResponse).toBeNull();
    expect(result.leaseVersion).toBeTruthy();
    expect(state.inserted[0]?.requestHash).toBe(REQUEST_HASH);
  });

  it("returns cached response on conflict", async () => {
    state.isFirstInsert = false;
    const cached = JSON.stringify({ ok: true });
    state.rows = [{ responseJson: cached }];
    const result = await checkIdempotency(createMockDb() as never, "k1", "pay", REQUEST_HASH);
    expect(result.shouldProceed).toBe(false);
    expect(result.cachedResponse).toBe(cached);
    expect(result.pending).toBe(false);
  });

  it("marks pending when sentinel still present", async () => {
    state.isFirstInsert = false;
    state.rows = [{ responseJson: "__pending__" }];
    const result = await checkIdempotency(createMockDb() as never, "k1", "pay", REQUEST_HASH);
    expect(result.shouldProceed).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.cachedResponse).toBeNull();
  });

  it("reclaims stale pending lease", async () => {
    state.isFirstInsert = false;
    state.rows = [{ responseJson: "__pending__" }];
    state.reclaimedRowsAffected = 1;
    const result = await checkIdempotency(createMockDb() as never, "k1", "pay", REQUEST_HASH);
    expect(result.shouldProceed).toBe(true);
    expect(result.leaseVersion).toBeTruthy();
  });

  it("detects request hash mismatch when hash is provided", async () => {
    state.isFirstInsert = false;
    state.rows = [{ responseJson: "{}", requestHash: "b".repeat(64), resourceId: "r1" }];
    const result = await checkIdempotency(createMockDb() as never, "k1", "pay", REQUEST_HASH);
    expect(result.requestMismatch).toBe(true);
    expect(result.shouldProceed).toBe(false);
  });

  it("legacy 3-arg call does not fail closed on empty stored hash", async () => {
    state.isFirstInsert = false;
    state.rows = [{ responseJson: '{"ok":1}', requestHash: "", resourceId: "s1" }];
    // 无第 4 参 → boundHash=""，不触发 mismatch
    const result = await checkIdempotency(createMockDb() as never, "k1", "form_submit");
    expect(result.requestMismatch).toBe(false);
    expect(result.cachedResponse).toBe('{"ok":1}');
  });
});

describe("saveIdempotentResponse", () => {
  beforeEach(reset);

  it("hardened path requires matching lease (rowsAffected)", async () => {
    state.savedRowsAffected = 1;
    await expect(
      saveIdempotentResponse(
        createMockDb() as never,
        "k1",
        "pay",
        REQUEST_HASH,
        "lease-1",
        "order-1",
        { ok: true },
      ),
    ).resolves.toBeUndefined();
  });

  it("hardened path throws when lease lost", async () => {
    state.savedRowsAffected = 0;
    await expect(
      saveIdempotentResponse(
        createMockDb() as never,
        "k1",
        "pay",
        REQUEST_HASH,
        "lease-stale",
        "order-1",
        { ok: true },
      ),
    ).rejects.toThrow(/租约已失效/);
  });

  it("legacy 5-arg path still works", async () => {
    state.savedRowsAffected = 1;
    await expect(
      saveIdempotentResponse(createMockDb() as never, "k1", "form_submit", "sub-1", {
        ok: true,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("clearPendingIdempotency", () => {
  beforeEach(reset);

  it("deletes matching pending row", async () => {
    await clearPendingIdempotency(
      createMockDb() as never,
      "k1",
      "pay",
      REQUEST_HASH,
      "lease-1",
    );
    expect(state.deleted).toBe(1);
  });
});
