/**
 * anti-abuse — 防刷检测插件
 *
 * 提供 API 级别的异常行为检测：
 * - 多 IP 访问同一资源
 * - 高频请求检测
 * - 凭证扫描检测（顺序遍历 ID）
 * - 快速连续操作检测
 *
 * 纯内存实现（Workers 实例级别），无需外部存储。
 *
 * 来源：vcode src/services/anti-abuse.ts
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════════

export type AbuseType = "multi_ip_access" | "high_frequency" | "token_scan" | "rapid_fire";

export interface AbuseEvent {
  type: AbuseType;
  resourceId: string;
  ipHash: string;
  timestamp: number;
  detail: string;
}

export interface AntiAbuseConfig {
  /** 同一资源允许的最大不同 IP 数（默认 5） */
  maxIpsPerResource?: number;
  /** 同一 IP 在窗口内允许的最大请求数（默认 30） */
  maxRequestsPerIp?: number;
  /** 请求频率窗口（毫秒，默认 60000） */
  windowMs?: number;
  /** 连续 ID 差值阈值（检测扫描，默认 3） */
  scanThreshold?: number;
  /** 快速连续操作最小间隔（毫秒，默认 500） */
  rapidFireIntervalMs?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AntiAbuseService
// ═══════════════════════════════════════════════════════════════════════════════

export class AntiAbuseService {
  readonly name = "anti-abuse";
  readonly version = "0.1.0";

  private config: Required<AntiAbuseConfig>;

  // 内存存储
  private resourceIps = new Map<string, Set<string>>();
  private ipRequests = new Map<string, number[]>();
  private lastAccessByIp = new Map<string, number>();
  private lastResourceIdByIp = new Map<string, string>();
  private events: AbuseEvent[] = [];

  constructor(config: AntiAbuseConfig = {}) {
    this.config = {
      maxIpsPerResource: config.maxIpsPerResource ?? 5,
      maxRequestsPerIp: config.maxRequestsPerIp ?? 30,
      windowMs: config.windowMs ?? 60_000,
      scanThreshold: config.scanThreshold ?? 3,
      rapidFireIntervalMs: config.rapidFireIntervalMs ?? 500,
    };
  }

  /**
   * 记录一次资源访问，返回检测到的异常事件列表
   */
  record(resourceId: string, ipHash: string): AbuseEvent[] {
    const now = Date.now();
    const detected: AbuseEvent[] = [];

    // 1. 多 IP 访问检测
    if (!this.resourceIps.has(resourceId)) {
      this.resourceIps.set(resourceId, new Set());
    }
    const ips = this.resourceIps.get(resourceId)!;
    ips.add(ipHash);
    if (ips.size > this.config.maxIpsPerResource) {
      detected.push({
        type: "multi_ip_access",
        resourceId,
        ipHash,
        timestamp: now,
        detail: `${ips.size} different IPs accessed this resource (limit: ${this.config.maxIpsPerResource})`,
      });
    }

    // 2. 高频请求检测
    if (!this.ipRequests.has(ipHash)) {
      this.ipRequests.set(ipHash, []);
    }
    const timestamps = this.ipRequests.get(ipHash)!;
    const windowStart = now - this.config.windowMs;
    const validTimestamps = timestamps.filter((ts) => ts > windowStart);
    validTimestamps.push(now);
    this.ipRequests.set(ipHash, validTimestamps);

    if (validTimestamps.length > this.config.maxRequestsPerIp) {
      detected.push({
        type: "high_frequency",
        resourceId,
        ipHash,
        timestamp: now,
        detail: `${validTimestamps.length} requests in ${this.config.windowMs}ms (limit: ${this.config.maxRequestsPerIp})`,
      });
    }

    // 3. 凭证扫描检测
    const lastId = this.lastResourceIdByIp.get(ipHash);
    if (lastId) {
      const idDiff = this.parseNumericId(resourceId) - this.parseNumericId(lastId);
      if (idDiff > 0 && idDiff <= this.config.scanThreshold) {
        detected.push({
          type: "token_scan",
          resourceId,
          ipHash,
          timestamp: now,
          detail: `Sequential ID access: ${lastId} → ${resourceId} (diff: ${idDiff})`,
        });
      }
    }
    this.lastResourceIdByIp.set(ipHash, resourceId);

    // 4. 快速连续操作检测
    const lastAccess = this.lastAccessByIp.get(ipHash);
    if (lastAccess && now - lastAccess < this.config.rapidFireIntervalMs) {
      detected.push({
        type: "rapid_fire",
        resourceId,
        ipHash,
        timestamp: now,
        detail: `Rapid access: ${now - lastAccess}ms (min: ${this.config.rapidFireIntervalMs}ms)`,
      });
    }
    this.lastAccessByIp.set(ipHash, now);

    // 记录事件
    for (const event of detected) {
      this.events.push(event);
    }

    return detected;
  }

  /**
   * 获取最近的异常事件
   */
  getEvents(limit = 50): AbuseEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * 检查某个 IP 是否可疑
   */
  isSuspicious(ipHash: string): boolean {
    return this.events.some((e) => e.ipHash === ipHash);
  }

  /**
   * 清理过期数据
   */
  cleanup(): void {
    const cutoff = Date.now() - this.config.windowMs * 2;
    for (const [ip, timestamps] of this.ipRequests) {
      const valid = timestamps.filter((ts) => ts > cutoff);
      if (valid.length === 0) this.ipRequests.delete(ip);
      else this.ipRequests.set(ip, valid);
    }
    this.events = this.events.filter((e) => e.timestamp > cutoff);
  }

  private parseNumericId(id: string): number {
    const match = id.match(/(\d+)$/);
    return match ? parseInt(match[1]) : 0;
  }
}
