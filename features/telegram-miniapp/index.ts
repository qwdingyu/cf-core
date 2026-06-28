/**
 * telegram-miniapp — Telegram Mini App 前端集成
 *
 * 提供 Vue 3 Composable，用于在 Telegram Mini App 中：
 * - 检测运行平台（Telegram / H5 × Mobile / Desktop）
 * - 应用 Telegram 主题变量到 CSS
 * - 控制 MainButton / BackButton
 * - 获取用户信息
 *
 * 来源：cf-shop frontend/src/composables/useTelegram.ts + usePlatform.ts
 *
 * 注意：此插件为前端代码，仅在 Vue 3 项目中使用。
 * 非 Vue 项目可参考实现自行适配。
 */

// ═══════════════════════════════════════════════════════════════════════════════
// 平台检测（纯函数，无 Vue 依赖）
// ═══════════════════════════════════════════════════════════════════════════════

export type Platform = "telegram-mobile" | "telegram-desktop" | "h5-mobile" | "h5-desktop";

export interface PlatformInfo {
  platform: Platform;
  isTelegram: boolean;
  isMobile: boolean;
  isDesktop: boolean;
}

/**
 * 检测当前运行平台
 */
export function detectPlatform(): PlatformInfo {
  const isTg = typeof window !== "undefined" && !!(window as any).Telegram?.WebApp;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const isMobileUA = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);

  const platform: Platform = isTg
    ? isMobileUA ? "telegram-mobile" : "telegram-desktop"
    : isMobileUA ? "h5-mobile" : "h5-desktop";

  return {
    platform,
    isTelegram: isTg,
    isMobile: isMobileUA,
    isDesktop: !isMobileUA,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Telegram 主题映射
// ═══════════════════════════════════════════════════════════════════════════════

/** Telegram 主题参数 → CSS 变量映射表 */
export const THEME_MAP: Record<string, string> = {
  bg_color: "--tg-bg",
  text_color: "--tg-text",
  hint_color: "--tg-hint",
  link_color: "--tg-link",
  button_color: "--tg-btn",
  button_text_color: "--tg-btn-text",
  secondary_bg_color: "--tg-secondary-bg",
  header_bg_color: "--tg-header-bg",
  bottom_bar_bg_color: "--tg-bottom-bar-bg",
  top_bar_bg_color: "--tg-top-bar-bg",
  destructive_text_color: "--tg-destructive",
  section_bg_color: "--tg-section-bg",
};

/**
 * 将 Telegram 主题参数应用到 CSS 变量
 */
export function applyTelegramTheme(params: Record<string, string>): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [tgKey, cssVar] of Object.entries(THEME_MAP)) {
    const value = params[tgKey];
    if (value) root.style.setProperty(cssVar, value);
  }
}

/**
 * 初始化 Telegram WebApp SDK
 *
 * @returns Telegram WebApp 实例或 null（非 Telegram 环境）
 */
export function initTelegramWebApp(): any | null {
  if (typeof window === "undefined") return null;
  const webApp = (window as any).Telegram?.WebApp;
  if (!webApp) return null;

  webApp.ready();
  webApp.expand();
  applyTelegramTheme(webApp.themeParams || {});

  webApp.onEvent?.("themeChanged", () => {
    applyTelegramTheme(webApp.themeParams || {});
  });

  return webApp;
}

/**
 * 获取 Telegram 用户信息（从 initDataUnsafe）
 */
export function getTelegramUser(): { id: number; firstName: string; lastName?: string; username?: string } | null {
  if (typeof window === "undefined") return null;
  const webApp = (window as any).Telegram?.WebApp;
  return webApp?.initDataUnsafe?.user ?? null;
}
