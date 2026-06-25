# telegram-miniapp — Telegram Mini App 前端集成

## 快速使用

```ts
import { detectPlatform, initTelegramWebApp, getTelegramUser, applyTelegramTheme } from "@eforge/cf-core/features/telegram-miniapp";

// 平台检测（纯函数，无框架依赖）
const { platform, isTelegram, isMobile } = detectPlatform();

// 初始化 Telegram SDK
const webApp = initTelegramWebApp();

// 获取用户信息
const user = getTelegramUser(); // { id, firstName, lastName, username }

// 手动应用主题（initTelegramWebApp 已自动处理）
applyTelegramTheme(webApp.themeParams);
```

## CSS 变量映射

Telegram 主题参数会自动映射为以下 CSS 变量：

| Telegram 参数 | CSS 变量 |
|--------------|---------|
| `bg_color` | `--tg-bg` |
| `text_color` | `--tg-text` |
| `button_color` | `--tg-btn` |
| `hint_color` | `--tg-hint` |
| `link_color` | `--tg-link` |
| ... | 见 `THEME_MAP` 常量 |

在 CSS 中使用：

```css
body { background: var(--tg-bg, #0f1117); color: var(--tg-text, #e4e4e7); }
.btn { background: var(--tg-btn, #6366f1); }
```

## 注意

此模块为前端代码，仅在浏览器/WebView 中使用。
Node.js 测试环境下 `detectPlatform()` 返回 `h5-desktop`。
