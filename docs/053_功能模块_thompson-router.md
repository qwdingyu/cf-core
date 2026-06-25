# thompson-router — Thompson Sampling 智能路由

## 快速使用

```ts
import { ThompsonRouter, wilsonScore } from "@usethink/cf-core/features/thompson-router";

const router = new ThompsonRouter();

const candidates = [
  { id: "5sim", name: "5sim.net", alpha: 20, beta: 3, enabled: true },
  { id: "grizzly", name: "GrizzlySMS", alpha: 10, beta: 5, enabled: true },
];

// 选择最佳渠道
const decision = router.select(candidates);

// 反馈结果
router.recordSuccess(candidates, decision.channelId); // α += 1
router.recordFailure(candidates, decision.channelId); // β += 1

// 故障转移
const failoverDecisions = router.selectWithFailover(candidates, 3);
```

## 算法说明

- **Thompson Sampling**：贝叶斯多臂老虎机，从 Beta(α,β) 分布采样
- **自动探索**：样本不足的渠道优先尝试
- **Wilson Score**：小样本成功率估计（比简单百分比更可靠）
