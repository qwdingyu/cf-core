/**
 * thompson-router — Thompson Sampling 智能路由插件
 *
 * 基于贝叶斯多臂老虎机算法的渠道选择器：
 * - 自动探索-利用平衡（新渠道多尝试，好渠道多使用）
 * - Beta 分布建模成功率（α=成功次数, β=失败次数）
 * - 自动故障转移（选中渠道失败时切换到下一候选）
 * - 可选多维度评分（成功率+价格+延迟+容量+趋势）
 *
 * 来源：vcode src/services/channel-router.ts + channel-scorer.ts
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════════

export interface ChannelCandidate {
  id: string;
  name: string;
  /** Beta 分布参数 α（成功次数 + 先验） */
  alpha: number;
  /** Beta 分布参数 β（失败次数 + 先验） */
  beta: number;
  /** 是否启用 */
  enabled: boolean;
  /** 优先级权重（越小越优先，用于同分时排序） */
  priority?: number;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

export interface RouteDecision {
  /** 选中的渠道 ID */
  channelId: string;
  /** 渠道名称 */
  channelName: string;
  /** 采样得分 */
  score: number;
  /** 候选数量 */
  candidateCount: number;
  /** 决策时间 */
  timestamp: string;
}

export interface ThompsonRouterConfig {
  /** Beta 分布先验参数（默认 α=1, β=1，即均匀分布） */
  priorAlpha?: number;
  priorBeta?: number;
  /** 最小样本量（低于此值的渠道会被优先探索） */
  minSamples?: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 统计采样工具
// ═══════════════════════════════════════════════════════════════════════════════

/** Marsaglia-Tsang 方法生成 Gamma 分布随机数 */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = gaussianRandom();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Box-Muller 变换生成标准正态分布 */
function gaussianRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 从 Beta(α, β) 分布采样 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ThompsonRouter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Thompson Sampling 渠道路由器
 *
 * @example
 * ```ts
 * import { ThompsonRouter } from "@iusethink/cf-core/plugins/thompson-router";
 *
 * const router = new ThompsonRouter();
 *
 * // 从数据库加载候选渠道
 * const candidates: ChannelCandidate[] = [
 *   { id: "5sim", name: "5sim.net", alpha: 15, beta: 3, enabled: true },
 *   { id: "grizzly", name: "GrizzlySMS", alpha: 10, beta: 5, enabled: true },
 * ];
 *
 * // 选择最佳渠道
 * const decision = router.select(candidates);
 * console.log(decision.channelName); // 大概率选中 5sim（成功率更高）
 *
 * // 反馈结果（更新 Beta 参数）
 * router.recordSuccess(candidates, "5sim"); // α += 1
 * router.recordFailure(candidates, "5sim"); // β += 1
 * ```
 */
export class ThompsonRouter {
  readonly name = "thompson-router";
  readonly version = "0.1.0";

  private config: Required<ThompsonRouterConfig>;

  constructor(config: ThompsonRouterConfig = {}) {
    this.config = {
      priorAlpha: config.priorAlpha ?? 1,
      priorBeta: config.priorBeta ?? 1,
      minSamples: config.minSamples ?? 5,
    };
  }

  /**
   * Thompson Sampling 选择最佳渠道
   */
  select(candidates: ChannelCandidate[]): RouteDecision {
    const eligible = candidates.filter((c) => c.enabled);
    if (eligible.length === 0) {
      throw new Error("No eligible channel candidates");
    }

    if (eligible.length === 1) {
      return {
        channelId: eligible[0].id,
        channelName: eligible[0].name,
        score: 1,
        candidateCount: 1,
        timestamp: new Date().toISOString(),
      };
    }

    // 优先探索样本不足的渠道
    const underExplored = eligible.filter(
      (c) => (c.alpha + c.beta) < this.config.minSamples + this.config.priorAlpha + this.config.priorBeta,
    );
    const pool = underExplored.length > 0 ? underExplored : eligible;

    // 对每个候选渠道从 Beta(α, β) 采样
    let bestCandidate = pool[0];
    let bestScore = -1;

    for (const candidate of pool) {
      const alpha = candidate.alpha + this.config.priorAlpha;
      const beta = candidate.beta + this.config.priorBeta;
      const score = sampleBeta(alpha, beta);

      if (score > bestScore || (score === bestScore && (candidate.priority ?? 100) < (bestCandidate.priority ?? 100))) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    return {
      channelId: bestCandidate.id,
      channelName: bestCandidate.name,
      score: bestScore,
      candidateCount: eligible.length,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * 选择渠道并支持自动故障转移
   */
  selectWithFailover(
    candidates: ChannelCandidate[],
    maxAttempts = 3,
  ): RouteDecision[] {
    const decisions: RouteDecision[] = [];
    const remaining = [...candidates];

    for (let i = 0; i < Math.min(maxAttempts, remaining.length); i++) {
      const decision = this.select(remaining);
      decisions.push(decision);
      // 移除已选渠道，下次选择时跳过
      const idx = remaining.findIndex((c) => c.id === decision.channelId);
      if (idx >= 0) remaining.splice(idx, 1);
      if (remaining.length === 0) break;
    }

    return decisions;
  }

  /**
   * 记录成功（更新 α 参数）
   */
  recordSuccess(candidates: ChannelCandidate[], channelId: string): void {
    const channel = candidates.find((c) => c.id === channelId);
    if (channel) channel.alpha += 1;
  }

  /**
   * 记录失败（更新 β 参数）
   */
  recordFailure(candidates: ChannelCandidate[], channelId: string): void {
    const channel = candidates.find((c) => c.id === channelId);
    if (channel) channel.beta += 1;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Wilson Score 成功率估计（小样本更可靠）
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Wilson Score Interval — 小样本成功率估计
 *
 * 比简单 success/total 更可靠，被 Reddit/Google 等用于排序。
 *
 * @param successes 成功次数
 * @param total 总次数
 * @param z 置信水平（默认 1.96 = 95%）
 */
export function wilsonScore(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const centre = p + z * z / (2 * total);
  const adjustment = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  return (centre - adjustment) / denominator;
}
