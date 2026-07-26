/**
 * 幂等性模块 — 防止同一请求被重复处理
 *
 * 使用 (key, action) 复合键作为幂等标识。
 * 核心设计：INSERT ON CONFLICT DO NOTHING + pending 哨兵 + 可选 requestHash 绑定 + 租约 fencing。
 *
 * 调用约定（两种签名，按参数个数区分）：
 *
 * 1) 兼容旧模板（cf-form 等，无请求摘要）：
 *    checkIdempotency(db, key, action)
 *    saveIdempotentResponse(db, key, action, resourceId, response)
 *
 * 2) 加固版（cf-shop 支付/充值）：
 *    checkIdempotency(db, key, action, requestHash)
 *    saveIdempotentResponse(db, key, action, requestHash, leaseVersion, resourceId, response)
 *    clearPendingIdempotency / clearCachedIdempotentResponse
 */

import { idempotencyKeys } from "./db/schema.js";
import { eq, and, lt } from "drizzle-orm";

const PENDING_SENTINEL = "__pending__";

/** Worker 中断后允许同一 requestHash 接管 pending 租约的窗口 */
export const IDEMPOTENCY_PENDING_LEASE_MS = 2 * 60 * 1000;

/** 标准 UUID 或足够长的 URL 安全随机串，降低可猜测键被用于读取缓存的风险 */
export const STRONG_IDEMPOTENCY_KEY_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[A-Za-z0-9_-]{32,120})$/i;

export function isStrongIdempotencyKey(value: string): boolean {
  return STRONG_IDEMPOTENCY_KEY_PATTERN.test(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

/** 规范化业务请求后做 SHA-256 hex，供 request_hash 绑定 */
export async function hashIdempotencyRequest(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type MutationResult = { rowsAffected?: number; changes?: number; meta?: { changes?: number } };

function affectedRows(result: unknown): number {
  const value =
    (result as MutationResult | undefined)?.rowsAffected ??
    (result as MutationResult | undefined)?.changes ??
    (result as MutationResult | undefined)?.meta?.changes ??
    0;
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
}

/**
 * 宽松 DB 形状：只约束本模块用到的 Drizzle 链式方法。
 * 下游可用真实 Drizzle 实例或测试 mock。
 */
export interface IdempotencyDb {
  insert: (table: typeof idempotencyKeys) => {
    values: (data: {
      key: string;
      action: string;
      resourceId: string;
      requestHash: string;
      responseJson: string;
      createdAt: string;
    }) => {
      onConflictDoNothing: (opts: {
        target: [typeof idempotencyKeys.key, typeof idempotencyKeys.action];
      }) => {
        returning: (cols: {
          responseJson: typeof idempotencyKeys.responseJson;
        }) => Promise<Array<{ responseJson: string }>>;
      };
      onConflictDoUpdate?: (opts: unknown) => {
        returning?: (cols: unknown) => Promise<Array<{ responseJson: string }>>;
      };
    };
  };
  select: (cols: Record<string, unknown>) => {
    from: (table: typeof idempotencyKeys) => {
      where: (cond: unknown) => {
        limit: (n: number) => Promise<
          Array<{
            responseJson: string;
            requestHash?: string;
            resourceId?: string;
          }>
        >;
      };
    };
  };
  update: (table: typeof idempotencyKeys) => {
    set: (data: Record<string, unknown>) => {
      where: (cond: unknown) => Promise<unknown>;
    };
  };
  delete: (table: typeof idempotencyKeys) => {
    where: (cond: unknown) => Promise<unknown>;
  };
}

export type IdempotencyCheckResult = {
  shouldProceed: boolean;
  cachedResponse: string | null;
  pending: boolean;
  requestMismatch: boolean;
  resourceId: string;
  leaseVersion: string;
};

/**
 * 原子检查幂等性。
 *
 * @param requestHash 可选。省略时按空串落库（兼容旧调用方，不绑定请求体）。
 */
export async function checkIdempotency(
  db: IdempotencyDb,
  key: string,
  action: string,
  requestHash = "",
): Promise<IdempotencyCheckResult> {
  const now = new Date();
  const nowIso = now.toISOString();
  const boundHash = String(requestHash || "");

  const [row] = await db
    .insert(idempotencyKeys)
    .values({
      key,
      action,
      resourceId: "",
      requestHash: boundHash,
      responseJson: PENDING_SENTINEL,
      createdAt: nowIso,
    })
    .onConflictDoNothing({ target: [idempotencyKeys.key, idempotencyKeys.action] })
    .returning({ responseJson: idempotencyKeys.responseJson });

  if (row?.responseJson === PENDING_SENTINEL) {
    return {
      shouldProceed: true,
      cachedResponse: null,
      pending: false,
      requestMismatch: false,
      resourceId: "",
      leaseVersion: nowIso,
    };
  }

  // 超时 pending 租约：同一 requestHash 可原子接管（createdAt 作 fencing 版本）
  const reclaimed = await db
    .update(idempotencyKeys)
    .set({ createdAt: nowIso })
    .where(
      and(
        eq(idempotencyKeys.key, key),
        eq(idempotencyKeys.action, action),
        eq(idempotencyKeys.requestHash, boundHash),
        eq(idempotencyKeys.resourceId, ""),
        eq(idempotencyKeys.responseJson, PENDING_SENTINEL),
        lt(idempotencyKeys.createdAt, new Date(now.getTime() - IDEMPOTENCY_PENDING_LEASE_MS).toISOString()),
      ),
    );
  if (affectedRows(reclaimed) > 0) {
    return {
      shouldProceed: true,
      cachedResponse: null,
      pending: false,
      requestMismatch: false,
      resourceId: "",
      leaseVersion: nowIso,
    };
  }

  const [existing] = await db
    .select({
      requestHash: idempotencyKeys.requestHash,
      resourceId: idempotencyKeys.resourceId,
      responseJson: idempotencyKeys.responseJson,
    })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.action, action)))
    .limit(1);

  if (!existing) {
    return {
      shouldProceed: false,
      cachedResponse: null,
      pending: true,
      requestMismatch: false,
      resourceId: "",
      leaseVersion: "",
    };
  }

  // 仅在调用方显式传入非空 hash 时做绑定校验（旧调用方 requestHash="" 不挡）
  if (boundHash && (!existing.requestHash || existing.requestHash !== boundHash)) {
    return {
      shouldProceed: false,
      cachedResponse: null,
      pending: false,
      requestMismatch: true,
      resourceId: existing.resourceId || "",
      leaseVersion: "",
    };
  }

  const pending = existing.responseJson === PENDING_SENTINEL;
  return {
    shouldProceed: false,
    cachedResponse: pending ? null : existing.responseJson,
    pending,
    requestMismatch: false,
    resourceId: existing.resourceId || "",
    leaseVersion: "",
  };
}

/**
 * 保存幂等响应。
 *
 * 加固签名（7 参数）：requestHash + leaseVersion fencing。
 * 兼容签名（5 参数）：(db, key, action, resourceId, response) — 无 fencing，覆盖写。
 */
export async function saveIdempotentResponse(
  db: IdempotencyDb,
  key: string,
  action: string,
  resourceIdOrRequestHash: string,
  responseOrLeaseVersion: unknown,
  maybeResourceId?: string,
  maybeResponse?: unknown,
): Promise<void> {
  const isHardened =
    typeof maybeResourceId === "string" &&
    maybeResponse !== undefined &&
    typeof responseOrLeaseVersion === "string";

  if (isHardened) {
    const requestHash = resourceIdOrRequestHash;
    const leaseVersion = responseOrLeaseVersion as string;
    const resourceId = maybeResourceId as string;
    const response = maybeResponse;
    const result = await db
      .update(idempotencyKeys)
      .set({
        responseJson: JSON.stringify(response),
        resourceId,
      })
      .where(
        and(
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.action, action),
          eq(idempotencyKeys.requestHash, requestHash),
          eq(idempotencyKeys.createdAt, leaseVersion),
        ),
      );
    if (affectedRows(result) !== 1) {
      throw new Error("幂等响应保存失败：租约已失效或预留记录不匹配");
    }
    return;
  }

  // 兼容路径：无 requestHash / lease fencing（cf-form 等）
  const resourceId = resourceIdOrRequestHash;
  const response = responseOrLeaseVersion;
  const nowIso = new Date().toISOString();
  const payload = JSON.stringify(response);

  // 优先 update 已有 pending/行；无行则 insert（极少：check 被跳过）
  const updated = await db
    .update(idempotencyKeys)
    .set({
      responseJson: payload,
      resourceId,
    })
    .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.action, action)));

  if (affectedRows(updated) > 0) return;

  await db.insert(idempotencyKeys).values({
    key,
    action,
    resourceId,
    requestHash: "",
    responseJson: payload,
    createdAt: nowIso,
  }).onConflictDoNothing({ target: [idempotencyKeys.key, idempotencyKeys.action] })
    .returning({ responseJson: idempotencyKeys.responseJson });

  // 冲突且 update 未命中时再强制 update（极端竞态）
  await db
    .update(idempotencyKeys)
    .set({ responseJson: payload, resourceId })
    .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.action, action)));
}

/** 删除仍为 pending 且匹配租约的预留行（业务失败回滚） */
export async function clearPendingIdempotency(
  db: IdempotencyDb,
  key: string,
  action: string,
  requestHash: string,
  leaseVersion: string,
): Promise<void> {
  await db.delete(idempotencyKeys).where(
    and(
      eq(idempotencyKeys.key, key),
      eq(idempotencyKeys.action, action),
      eq(idempotencyKeys.requestHash, requestHash),
      eq(idempotencyKeys.createdAt, leaseVersion),
      eq(idempotencyKeys.responseJson, PENDING_SENTINEL),
    ),
  );
}

/** 仅当缓存仍等于 expectedResponse 时删除，避免抹掉并发更新 */
export async function clearCachedIdempotentResponse(
  db: IdempotencyDb,
  key: string,
  action: string,
  requestHash: string,
  leaseVersion: string,
  expectedResponse: unknown,
): Promise<void> {
  await db.delete(idempotencyKeys).where(
    and(
      eq(idempotencyKeys.key, key),
      eq(idempotencyKeys.action, action),
      eq(idempotencyKeys.requestHash, requestHash),
      eq(idempotencyKeys.createdAt, leaseVersion),
      eq(idempotencyKeys.responseJson, JSON.stringify(expectedResponse)),
    ),
  );
}

/**
 * 查询已缓存的幂等响应（只读，不创建记录）
 *
 * @deprecated 使用 checkIdempotency() 替代
 */
export async function getIdempotentResponse(
  db: IdempotencyDb,
  key: string,
  action: string,
): Promise<{ responseJson: string } | null> {
  const [row] = await db
    .select({ responseJson: idempotencyKeys.responseJson })
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.action, action)))
    .limit(1);
  return row || null;
}
