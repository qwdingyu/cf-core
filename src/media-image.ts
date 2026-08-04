/**
 * 受控媒体图片：魔数检测、校验、R2 key 约束。
 *
 * 产品差异（大小上限、文案、上传路径）由调用方注入，本模块不硬编码 shop/lottery 业务值。
 */

export const MEDIA_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

export type SupportedMediaImage = {
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  extension: "jpg" | "png" | "webp" | "avif";
};

export type ValidateMediaImageOptions = {
  /** 单文件最大字节数（由产品配置，如 5MiB / 2MiB） */
  maxBytes: number;
  emptyMessage?: string;
  /** 超限文案；缺省为通用中文，产品可传入「不能超过 5MiB」等 */
  oversizeMessage?: string;
  unsupportedMessage?: string;
  mismatchMessage?: string;
};

const JPEG: SupportedMediaImage = { contentType: "image/jpeg", extension: "jpg" };
const PNG: SupportedMediaImage = { contentType: "image/png", extension: "png" };
const WEBP: SupportedMediaImage = { contentType: "image/webp", extension: "webp" };
const AVIF: SupportedMediaImage = { contentType: "image/avif", extension: "avif" };

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)));
}

/**
 * 根据文件签名识别图片类型，不能信任浏览器提交的 MIME 或文件扩展名。
 * 明确拒绝 SVG/GIF，避免脚本内容与动画资源扩大安全边界。
 */
export function detectMediaImage(bytes: Uint8Array): SupportedMediaImage | null {
  if (bytes.length < 12) return null;
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return JPEG;
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return WEBP;
  // AVIF：ISO BMFF，第 4-7 字节 ftyp，兼容品牌含 avif/avis
  if (ascii(bytes, 4, 8) === "ftyp" && /avif|avis/.test(ascii(bytes, 8, 32))) return AVIF;
  return null;
}

export function validateMediaImage(
  file: File,
  bytes: Uint8Array,
  options: ValidateMediaImageOptions,
): SupportedMediaImage {
  const emptyMessage = options.emptyMessage ?? "请选择非空图片文件";
  const oversizeMessage = options.oversizeMessage ?? "图片超过大小限制";
  const unsupportedMessage = options.unsupportedMessage ?? "仅支持 JPEG、PNG、WebP 或 AVIF 图片";
  const mismatchMessage = options.mismatchMessage ?? "图片内容与文件类型不一致";

  if (file.size <= 0) throw new Error(emptyMessage);
  if (file.size > options.maxBytes) throw new Error(oversizeMessage);

  const detected = detectMediaImage(bytes);
  if (!detected) throw new Error(unsupportedMessage);

  const declared = file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type.toLowerCase();
  if (declared && declared !== detected.contentType) {
    throw new Error(mismatchMessage);
  }
  return detected;
}

export function createMediaImageKey(extension: SupportedMediaImage["extension"]): string {
  return `images/${crypto.randomUUID().toLowerCase()}.${extension}`;
}

export function isManagedMediaImageKey(key: string): boolean {
  return /^images\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp|avif)$/.test(
    key,
  );
}

/** 公开读取时从受控 key 推导 MIME，不信任可被外部改写的对象元数据。 */
export function getManagedMediaImageContentType(key: string): SupportedMediaImage["contentType"] | null {
  if (!isManagedMediaImageKey(key)) return null;
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  if (key.endsWith(".avif")) return "image/avif";
  return null;
}
