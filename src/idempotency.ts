/**
 * 幂等性模块 — 防止同一请求被重复处理
 *
 * 使用 (key, action) 复合键作为幂等标识。
 * 核心设计：原子 UPSERT + 非空哨兵值，消除 TOCTOU 竞态。
 *
 * 流程：
 * 1. checkIdempotency() — 原子 UPSERT，返回 shouldProceed
 * 2. shouldProceed === false → 返回缓存响应
 * 3. shouldProceed === true → 执行业务逻辑 → saveIdempotentResponse()
 *
 * 来源：cf-shop src/lib/idempotency.ts（三项目中唯一实现）
 */

import { idempotencyKeys } from "./db/schema.js";
import { eq, and, sql } from "drizzle-orm";

const PENDING_SENTINEL = "__pending__";

/**
 * 通用 Drizzle 数据库接口（仅约束幂等模块需要的方法）
 */
interface DbLike {
  insert: (table: typeof idempotencyKeys) => {
    values: (data: { key: string; action: string; resourceId: string; responseJson: string; createdAt: string }) => {
      onConflictDoUpdate: (opts: {
        target: [typeof idempotencyKeys.key, typeof idempotencyKeys.action];
        set: Record<string, unknown>;
      }) => {
        returning: (cols: { responseJson: typeof idempotencyKeys.responseJson }) => Promise<{ responseJson: string }[]>;
      };
    };
  };
  select: (cols: { responseJson: typeof idempotencyKeys.responseJson }) => {
    from: (table: typeof idempotencyKeys) => {
      where: (cond: unknown) => {
        limit: (n: number) => Promise<{ responseJson: string }[]>;
      };
    };
  };
}

/**
 * 原子检查幂等性
 *
 * INSERT ON CONFLICT UPDATE RETURNING 是 SQLite 原子操作。
 * 并发请求中只有一个获得 shouldProceed=true。
 *
 * @returns shouldProceed=true 时应执行业务逻辑；false 时 cachedResponse 含之前缓存的响应
 */
export async function checkIdempotency(
  db: DbLike,
  key: string,
  action: string,
): Promise<{ shouldProceed: boolean; cachedResponse: string | null }> {
  const [row] = await db
    .insert(idempotencyKeys)
    .values({
      key,
      action,
      resourceId: "",
      responseJson: PENDING_SENTINEL,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [idempotencyKeys.key, idempotencyKeys.action],
      set: { responseJson: sql`idempotency_keys.response_json` },
    })
    .returning({ responseJson: idempotencyKeys.responseJson });

  const shouldProceed = row?.responseJson === PENDING_SENTINEL;
  const cachedResponse = shouldProceed
    ? null
    : row?.responseJson === PENDING_SENTINEL
      ? null
      : row?.responseJson ?? null;

  return { shouldProceed, cachedResponse };
}

/**
 * 保存幂等响应
 *
 * 在 checkIdempotency 返回 shouldProceed=true 并执行业务逻辑后调用。
 */
export async function saveIdempotentResponse(
  db: DbLike,
  key: string,
  action: string,
  resourceId: string,
  response: unknown,
): Promise<void> {
  await db
    .insert(idempotencyKeys)
    .values({
      key,
      action,
      resourceId,
      responseJson: JSON.stringify(response),
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [idempotencyKeys.key, idempotencyKeys.action],
      set: {
        responseJson: JSON.stringify(response),
        resourceId,
      },
    });
}

/**
 * 查询已缓存的幂等响应（只读，不创建记录）
 *
 * @deprecated 使用 checkIdempotency() 替代
 */
export async function getIdempotentResponse(
  db: DbLike,
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
