import { describe, it, expect } from "vitest";
import { ThompsonRouter, wilsonScore } from "../index";
import type { ChannelCandidate } from "../index";

describe("ThompsonRouter", () => {
  const candidates: ChannelCandidate[] = [
    { id: "ch-a", name: "Channel A", alpha: 20, beta: 2, enabled: true },
    { id: "ch-b", name: "Channel B", alpha: 5, beta: 15, enabled: true },
    { id: "ch-c", name: "Channel C", alpha: 1, beta: 1, enabled: true },
  ];

  it("单渠道直接返回", () => {
    const router = new ThompsonRouter();
    const single = [{ ...candidates[0] }];
    const decision = router.select(single);
    expect(decision.channelId).toBe("ch-a");
    expect(decision.candidateCount).toBe(1);
  });

  it("过滤禁用渠道", () => {
    const router = new ThompsonRouter();
    const mixed = [
      { id: "disabled", name: "Disabled", alpha: 100, beta: 0, enabled: false },
      { id: "enabled", name: "Enabled", alpha: 1, beta: 1, enabled: true },
    ];
    const decision = router.select(mixed);
    expect(decision.channelId).toBe("enabled");
  });

  it("无可用渠道抛错", () => {
    const router = new ThompsonRouter();
    expect(() => router.select([
      { id: "x", name: "X", alpha: 1, beta: 1, enabled: false },
    ])).toThrow("No eligible");
  });

  it("selectWithFailover 返回多个决策", () => {
    const router = new ThompsonRouter();
    const decisions = router.selectWithFailover([...candidates], 2);
    expect(decisions.length).toBe(2);
    expect(decisions[0].channelId).not.toBe(decisions[1].channelId);
  });

  it("recordSuccess 增加 alpha", () => {
    const router = new ThompsonRouter();
    const c = [{ id: "x", name: "X", alpha: 5, beta: 5, enabled: true }];
    router.recordSuccess(c, "x");
    expect(c[0].alpha).toBe(6);
  });

  it("recordFailure 增加 beta", () => {
    const router = new ThompsonRouter();
    const c = [{ id: "x", name: "X", alpha: 5, beta: 5, enabled: true }];
    router.recordFailure(c, "x");
    expect(c[0].beta).toBe(6);
  });

  it("高成功率渠道被选中概率更大", () => {
    const router = new ThompsonRouter();
    const high = { id: "high", name: "High", alpha: 100, beta: 5, enabled: true };
    const low = { id: "low", name: "Low", alpha: 5, beta: 100, enabled: true };
    let highCount = 0;
    for (let i = 0; i < 100; i++) {
      const d = router.select([{ ...high }, { ...low }]);
      if (d.channelId === "high") highCount++;
    }
    // Thompson Sampling 应该大部分时间选中高成功率渠道
    expect(highCount).toBeGreaterThan(70);
  });
});

describe("wilsonScore", () => {
  it("无数据返回 0", () => {
    expect(wilsonScore(0, 0)).toBe(0);
  });

  it("100% 成功率", () => {
    const score = wilsonScore(100, 100);
    expect(score).toBeGreaterThan(0.95);
  });

  it("小样本比大样本保守", () => {
    const small = wilsonScore(3, 3); // 100% but only 3 samples
    const large = wilsonScore(100, 100); // 100% with 100 samples
    expect(small).toBeLessThan(large);
  });

  it("50% 成功率", () => {
    const score = wilsonScore(50, 100);
    expect(score).toBeGreaterThan(0.35);
    expect(score).toBeLessThan(0.55);
  });
});
