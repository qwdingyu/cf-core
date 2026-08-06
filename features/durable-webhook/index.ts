/**
 * durable-webhook — 持久化 Webhook 投递引擎（docs/091 P1-9）。
 *
 * 与 features/webhook（fire-and-forget）互补：本模块落库每笔交付记录，
 * 支持 cron 重试、幂等去重（eventId）、签名验证。
 * 携带两张公共表：webhook_subscriptions / webhook_deliveries。
 *
 * 来源：cf-lottery webhook_configs / enqueueWebhookEvent 模式
 */
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";

// ═══════════════════════════════════════════════════════════════════════════════
// Schema（两张公共表）
// ═══════════════════════════════════════════════════════════════════════════════

/** Webhook 订阅配置 */
export const webhookSubscription = sqliteTable(
  "webhook_subscription",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    eventTypes: text("event_types").notNull(),       // 逗号分隔事件类型
    signingSecret: text("signing_secret"),            // HMAC-SHA256 密钥
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    maxRetries: integer("max_retries").notNull().default(3),
    timeoutMs: integer("timeout_ms").notNull().default(8000),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("webhook_subscription_active_idx").on(t.active)],
);

/** Webhook 交付记录 */
export const webhookDelivery = sqliteTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    subscriptionId: text("subscription_id").notNull(),
    eventType: text("event_type").notNull(),
    eventId: text("event_id").notNull(),              // 幂等去重 key
    payload: text("payload").notNull(),                // JSON
    status: text("status").notNull(),                  // pending | success | failed | retrying
    statusCode: integer("status_code"),
    error: text("error"),
    attempt: integer("attempt").notNull().default(0),
    nextRetryAt: integer("next_retry_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("webhook_delivery_status_idx").on(t.status),
    index("webhook_delivery_event_id_idx").on(t.eventId),
    index("webhook_delivery_next_retry_idx").on(t.nextRetryAt),
  ],
);

// ═══════════════════════════════════════════════════════════════════════════════
// DurableWebhookClient
// ═══════════════════════════════════════════════════════════════════════════════

export interface DurableWebhookConfig {
  /** 一次投递最多重试次数（默认 3） */
  maxRetries?: number;
  /** 每次重试间隔基数 ms（默认 60s，指数退避：60s/120s/240s） */
  retryBaseMs?: number;
  /** 请求超时 ms（默认 8000） */
  timeoutMs?: number;
}

/**
 * 持久化 Webhook 客户端：幂等入队 + 签名 + 重试。
 *
 * 使用方式：
 *   const client = new DurableWebhookClient(db, { maxRetries: 3 });
 *   await client.enqueue("order.paid", { orderId: "123" }, "evt_001");
 *
 *   // cron 重试（每分钟或按调度触发）
 *   await client.retryPending();
 */
export class DurableWebhookClient {
  private maxRetries: number;
  private retryBaseMs: number;
  private timeoutMs: number;

  constructor(
    private db: DurableWebhookDb,
    config: DurableWebhookConfig = {},
  ) {
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 60_000;
    this.timeoutMs = config.timeoutMs ?? 8000;
  }

  /**
   * 入队事件：向所有匹配 eventType 的活跃订阅投递。
   * eventId 用作幂等去重（同 eventId 不重复投递）。
   */
  async enqueue(
    eventType: string,
    payload: Record<string, unknown>,
    eventId: string,
  ): Promise<number> {
    // 幂等检查
    const [existing] = await (this.db.select({ id: webhookDelivery.id }) as any)
      .from(webhookDelivery)
      .where((ref: any) => ref.eq(webhookDelivery.eventId, eventId))
      .limit(1);
    if (existing) return 0;

    const subs = await (this.db.select() as any)
      .from(webhookSubscription)
      .where((ref: any) => ref.eq(webhookSubscription.active, true));
    const now = new Date();
    let count = 0;

    for (const sub of subs as any[]) {
      const events: string[] = (sub.eventTypes || "").split(",").map((s: string) => s.trim());
      if (!events.includes(eventType)) continue;
      if (!sub.url?.startsWith("http")) continue;

      const id = crypto.randomUUID();
      await (this.db.insert(webhookDelivery) as any).values({
        id,
        subscriptionId: sub.id,
        eventType,
        eventId,
        payload: JSON.stringify(payload),
        status: "pending",
        attempt: 0,
        createdAt: now,
        updatedAt: now,
      });
      count++;
    }

    // 立即尝试投递
    if (count > 0) await this.deliverPending();
    return count;
  }

  /**
   * 投递所有 pending/retrying 记录
   */
  async deliverPending(): Promise<{ ok: number; failed: number }> {
    const rows = await (this.db.select() as any)
      .from(webhookDelivery)
      .where((ref: any) =>
        ref.inArray(webhookDelivery.status, ["pending", "retrying"]).and(
          ref.lte(webhookDelivery.nextRetryAt, new Date()),
        ),
      );
    let ok = 0, failed = 0;
    for (const delivery of rows as any[]) {
      const sub = await this.getSubscription(delivery.subscriptionId);
      const result = await this.deliverOne(delivery, sub);
      result.ok ? ok++ : failed++;
    }
    return { ok, failed };
  }

  /** cron 重试入口：投递 pending + 将 failed 且未达最大重试的改为 retrying */
  async retryPending(): Promise<{ ok: number; failed: number }> {
    // 将到期的 failed 记录改为 retrying
    await (this.db.update(webhookDelivery) as any)
      .set({ status: "retrying", updatedAt: new Date() })
      .where((ref: any) =>
        ref.eq(webhookDelivery.status, "failed").and(
          ref.lt(webhookDelivery.attempt, this.maxRetries),
        ).and(ref.lte(webhookDelivery.nextRetryAt, new Date())),
      );
    return this.deliverPending();
  }

  private async deliverOne(
    delivery: any,
    sub: any,
  ): Promise<{ ok: boolean }> {
    const payload = JSON.parse(delivery.payload);
    const body = JSON.stringify({ event: delivery.eventType, timestamp: new Date().toISOString(), data: payload });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Webhook-Event": delivery.eventType,
    };
    if (sub?.signingSecret) {
      headers["X-Webhook-Signature"] = await this.sign(body, sub.signingSecret);
    }

    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      const res = await fetch(sub.url, { method: "POST", headers, body, signal: ctrl.signal });
      clearTimeout(timer);

      await (this.db.update(webhookDelivery) as any).set({
        status: res.ok ? "success" : "failed",
        statusCode: res.status,
        error: res.ok ? null : `HTTP ${res.status}`,
        attempt: delivery.attempt + 1,
        updatedAt: new Date(),
      }).where((ref: any) => ref.eq(webhookDelivery.id, delivery.id));

      return { ok: res.ok };
    } catch (err: any) {
      const nextAttempt = delivery.attempt + 1;
      const failed = nextAttempt >= this.maxRetries;
      await (this.db.update(webhookDelivery) as any).set({
        status: failed ? "failed" : "retrying",
        error: err.message || String(err),
        attempt: nextAttempt,
        nextRetryAt: failed ? null : new Date(Date.now() + this.retryBaseMs * Math.pow(2, nextAttempt)),
        updatedAt: new Date(),
      }).where((ref: any) => ref.eq(webhookDelivery.id, delivery.id));
      return { ok: false };
    }
  }

  private async getSubscription(id: string) {
    const [row] = await (this.db.select() as any)
      .from(webhookSubscription)
      .where((ref: any) => ref.eq(webhookSubscription.id, id))
      .limit(1);
    return row || null;
  }

  private async sign(body: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
}

/** 数据库接口（消费方实际 Drizzle 实例适配） */
export interface DurableWebhookDb {
  select: (...args: unknown[]) => { from: (table: unknown) => { where: (fn: unknown) => { limit: (n: number) => Promise<unknown[]> } } };
  insert: (table: unknown) => { values: (data: Record<string, unknown>) => Promise<unknown> };
  update: (table: unknown) => { set: (data: Record<string, unknown>) => { where: (fn: unknown) => Promise<unknown> } };
}
