/**
 * Workers Cache API 封装
 *
 * Cloudflare Free 套餐的 Cache API 完全免费，不计入 10 万次/天的请求限制。
 * 这是 Free 套餐下唯一能免费扩容的手段，必须充分利用。
 *
 * 使用场景：
 * - GET /products（商品列表，TTL 5 分钟）
 * - GET /system-config（系统配置，TTL 30 分钟）
 * - 任何读多写少的 API 响应
 *
 * 来源：eshop src/lib/cache.ts
 */

/**
 * 创建命名空间化的 Cache 实例。
 *
 * @param namespace - 缓存命名空间（通常为项目名，如 "eshop-v1"）
 */
export function createCache(namespace: string) {
  function key(path: string, query?: string): string {
    const base = `https://cache.local/${namespace}${path}`;
    return query ? `${base}?${query}` : base;
  }

  return {
    /**
     * 从 Cache API 读取
     */
    async get(cacheKey: string): Promise<Response | null> {
      try {
        const match = await caches.default.match(cacheKey);
        return match || null;
      } catch (err) {
        console.warn("[cache] get failed:", err);
        return null;
      }
    },

    /**
     * 写入 Cache API
     */
    async put(cacheKey: string, response: Response, ttlSeconds: number): Promise<void> {
      try {
        const clone = response.clone();
        const headers = new Headers(clone.headers);
        headers.set("Cache-Control", `public, max-age=${ttlSeconds}`);
        headers.set("CF-Cache-Status", "HIT");
        const cachedResponse = new Response(clone.body, {
          status: clone.status,
          statusText: clone.statusText,
          headers,
        });
        await caches.default.put(cacheKey, cachedResponse);
      } catch (err) {
        console.warn("[cache] put failed:", err);
      }
    },

    /**
     * 删除缓存
     */
    async delete(cacheKey: string): Promise<boolean> {
      try {
        return await caches.default.delete(cacheKey);
      } catch (err) {
        console.warn("[cache] delete failed:", err);
        return false;
      }
    },

    /** 缓存键生成器（暴露供外部使用） */
    key,
  };
}

/** 默认实例（无命名空间，适用于单项目场景） */
export const cache = createCache("default");
