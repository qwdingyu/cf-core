# anti-abuse — 防刷检测功能模块

## 快速使用

```ts
import { AntiAbuseService } from "@iusethink/cf-core/features/anti-abuse";

const abuse = new AntiAbuseService({
  maxIpsPerResource: 5,      // 同一资源最大不同 IP 数
  maxRequestsPerIp: 30,       // 窗口内最大请求数
  windowMs: 60_000,           // 窗口时长
  rapidFireIntervalMs: 500,   // 最小访问间隔
});

// 每次访问时记录
const events = abuse.record(resourceId, ipHash);
if (events.length > 0) {
  console.warn("Abuse detected:", events);
}

// 检查 IP 是否可疑
abuse.isSuspicious(ipHash); // true/false

// 清理过期数据
abuse.cleanup();
```

## 检测类型

| 类型 | 说明 |
|------|------|
| `multi_ip_access` | 多 IP 访问同一资源 |
| `high_frequency` | 高频请求 |
| `token_scan` | 顺序遍历 ID（凭证扫描） |
| `rapid_fire` | 快速连续操作 |
