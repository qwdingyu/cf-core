import { describe, it, expect } from "vitest";
import {
  signJwt,
  verifyJwt,
  signJwtWithClaims,
  verifyJwtClaims,
} from "../src/auth/jwt.js";

const SECRET = "test-secret-0123456789";

describe("JWT — 泛型 claims（docs/091 P0-4）", () => {
  it("signJwtWithClaims 携带自定义 claims 且注入 iat/exp", async () => {
    const token = await signJwtWithClaims(
      { sub: "user-1", email: "a@b.com", tenantId: "tenant-9", role: "admin" },
      SECRET,
      3600,
    );
    expect(token.split(".")).toHaveLength(3);

    const claims = await verifyJwtClaims(token, SECRET);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("user-1");
    expect(claims?.tenantId).toBe("tenant-9");
    expect(claims?.role).toBe("admin");
    expect(typeof claims?.iat).toBe("number");
    expect(typeof claims?.exp).toBe("number");
    expect(claims!.exp - claims!.iat).toBe(3600);
  });

  it("verifyJwtClaims 拒绝过期 token", async () => {
    const token = await signJwtWithClaims({ sub: "u" }, SECRET, -10);
    await expect(verifyJwtClaims(token, SECRET)).resolves.toBeNull();
  });

  it("verifyJwtClaims 拒绝错误密钥签名", async () => {
    const token = await signJwtWithClaims({ sub: "u" }, "other-secret", 3600);
    await expect(verifyJwtClaims(token, SECRET)).resolves.toBeNull();
  });

  it("verifyJwtClaims 拒绝被篡改的 payload", async () => {
    const token = await signJwtWithClaims({ sub: "u", tenantId: "t1" }, SECRET, 3600);
    const [h, , s] = token.split(".");
    // 篡改 payload（把 t1 换成 t2），签名不变 → 验证必须失败
    const forgedBody = Buffer.from(JSON.stringify({ sub: "u", tenantId: "t2", iat: 1, exp: 9999999999 })).toString("base64url");
    await expect(verifyJwtClaims(`${h}.${forgedBody}.${s}`, SECRET)).resolves.toBeNull();
  });

  it("旧版 signJwt/verifyJwt 兼容层仍工作", async () => {
    const token = await signJwt("user-1", "a@b.com", SECRET, 3600);
    const payload = await verifyJwt(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("user-1");
    expect(payload?.email).toBe("a@b.com");
  });

  it("旧版 verifyJwt 对缺 email 的泛型 token 返回 null（形状保护）", async () => {
    const token = await signJwtWithClaims({ sub: "u" }, SECRET, 3600);
    await expect(verifyJwt(token, SECRET)).resolves.toBeNull();
    // 但泛型版可读
    await expect(verifyJwtClaims(token, SECRET)).resolves.toMatchObject({ sub: "u" });
  });
});
