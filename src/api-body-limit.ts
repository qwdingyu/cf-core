/**
 * API 请求体上限工厂：默认 JSON 上限 + 指定媒体上传路径放宽。
 * 路径与字节数由产品注入，本模块不绑定具体路由表。
 */

export type ApiBodyLimitOptions = {
  /** 普通 JSON API 上限（字节） */
  defaultBytes: number;
  /** 媒体上传请求上限（通常 = 文件上限 + multipart 开销） */
  mediaUploadBytes: number;
  /**
   * 允许放大 body 的路径。
   * - string：精确匹配
   * - string[]：任一精确匹配
   * - (path) => boolean：自定义（含前缀匹配）
   */
  mediaUploadPath: string | readonly string[] | ((path: string) => boolean);
};

export type ApiBodyLimitResolver = (path: string) => number;

function matchesMediaPath(
  path: string,
  mediaUploadPath: ApiBodyLimitOptions["mediaUploadPath"],
): boolean {
  if (typeof mediaUploadPath === "function") return mediaUploadPath(path);
  if (typeof mediaUploadPath === "string") return path === mediaUploadPath;
  return mediaUploadPath.includes(path);
}

/**
 * 创建路径 → body 上限解析函数。
 * 仅媒体上传路径使用 mediaUploadBytes，其余使用 defaultBytes。
 */
export function createApiBodyLimitResolver(options: ApiBodyLimitOptions): ApiBodyLimitResolver {
  const { defaultBytes, mediaUploadBytes, mediaUploadPath } = options;
  if (!Number.isFinite(defaultBytes) || defaultBytes < 0) {
    throw new Error("defaultBytes must be a non-negative finite number");
  }
  if (!Number.isFinite(mediaUploadBytes) || mediaUploadBytes < 0) {
    throw new Error("mediaUploadBytes must be a non-negative finite number");
  }
  return (path: string) =>
    matchesMediaPath(path, mediaUploadPath) ? mediaUploadBytes : defaultBytes;
}

/**
 * 便捷：文件上限 + 固定 multipart 开销 → 上传请求上限。
 */
export function mediaUploadRequestLimitBytes(
  fileLimitBytes: number,
  multipartOverheadBytes = 64 * 1024,
): number {
  if (!Number.isFinite(fileLimitBytes) || fileLimitBytes < 0) {
    throw new Error("fileLimitBytes must be a non-negative finite number");
  }
  if (!Number.isFinite(multipartOverheadBytes) || multipartOverheadBytes < 0) {
    throw new Error("multipartOverheadBytes must be a non-negative finite number");
  }
  return fileLimitBytes + multipartOverheadBytes;
}

/**
 * content-length 头闸门（纯函数，不依赖 Hono）。
 * 非法/缺失头视为「未知长度」，由调用方决定是否再走流式计数。
 */
export function isContentLengthOverLimit(
  contentLengthHeader: string | null | undefined,
  limitBytes: number,
): boolean {
  const length = Number(contentLengthHeader || "0");
  return Number.isFinite(length) && length > limitBytes;
}

export type ReadBodyWithinLimitOk = {
  ok: true;
  /** 拼好的 body；无 body 时为 null */
  body: Uint8Array | null;
  total: number;
};

export type ReadBodyWithinLimitOversize = {
  ok: false;
  reason: "oversized";
  total: number;
};

export type ReadBodyWithinLimitResult = ReadBodyWithinLimitOk | ReadBodyWithinLimitOversize;

/**
 * 流式读取 request body 并强制字节上限（防 chunked 绕过 content-length）。
 * 不绑定 Hono/fail：产品侧用结果决定 413 文案与是否重建 Request。
 *
 * 超限时停止继续读（已消费的流不可再用于下游）；调用方应直接返回 413。
 */
export async function readRequestBodyWithinLimit(
  body: ReadableStream<Uint8Array> | null | undefined,
  limitBytes: number,
): Promise<ReadBodyWithinLimitResult> {
  if (!Number.isFinite(limitBytes) || limitBytes < 0) {
    throw new Error("limitBytes must be a non-negative finite number");
  }
  if (!body) {
    return { ok: true, body: null, total: 0 };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limitBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore cancel errors */
      }
      return { ok: false, reason: "oversized", total };
    }
    chunks.push(value);
  }

  if (total === 0) {
    return { ok: true, body: new Uint8Array(0), total: 0 };
  }

  const buf = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: buf, total };
}

/**
 * 在已读 body 字节上重建 Request（供 Hono 下游 c.req.json() 等继续解析）。
 * 仅当 readRequestBodyWithinLimit 成功且 body 非 null 时使用。
 */
export function rebuildRequestWithBody(original: Request, body: Uint8Array): Request {
  const headers = new Headers(original.headers);
  headers.set("content-length", String(body.byteLength));
  return new Request(original.url, {
    method: original.method,
    headers,
    body,
  });
}
