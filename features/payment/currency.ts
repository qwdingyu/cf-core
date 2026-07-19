import type { PaymentProvider } from "./types.js";

export type CurrencyExponentMap = Readonly<Record<string, number>>;

export function normalizeCurrencyCode(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z][A-Z0-9]{1,15}$/.test(normalized)) {
    throw new RangeError("Invalid currency code");
  }
  return normalized;
}

function currencyExponent(currency: unknown, exponents: CurrencyExponentMap): { code: string; exponent: number } {
  const code = normalizeCurrencyCode(currency);
  if (!Object.prototype.hasOwnProperty.call(exponents, code)) {
    throw new RangeError(`Unsupported currency: ${code}`);
  }
  const exponent = exponents[code];
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 15 || !Number.isSafeInteger(10 ** exponent)) {
    throw new RangeError(`Invalid currency exponent for ${code}`);
  }
  return { code, exponent };
}

export function assertSafeMinorUnits(value: number, positive = false): number {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError("Money minor units must be a safe integer");
  }
  if (positive && value <= 0) {
    throw new RangeError("Payment provider amount must be greater than zero");
  }
  return value;
}

export function parseMajorToMinor(
  value: string,
  currency: unknown,
  exponents: CurrencyExponentMap,
): number {
  const { code, exponent } = currencyExponent(currency, exponents);
  const normalized = value.trim();
  if (!normalized) throw new TypeError("Money amount is required");
  if (exponent === 0 && normalized.includes(".")) {
    throw new TypeError(`${code} does not allow decimal places`);
  }

  const pattern = exponent === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${exponent}})?$`);
  if (!pattern.test(normalized)) {
    throw new TypeError(`Invalid ${code} major-unit amount`);
  }

  const [majorText, fractionText = ""] = normalized.split(".");
  const factor = 10 ** exponent;
  const major = Number(majorText);
  const fraction = Number(fractionText.padEnd(exponent, "0") || "0");
  if (!Number.isSafeInteger(major) || major > Math.floor((Number.MAX_SAFE_INTEGER - fraction) / factor)) {
    throw new RangeError("Money amount exceeds the safe integer range");
  }
  return major * factor + fraction;
}

export function minorToMajorString(
  value: number,
  currency: unknown,
  exponents: CurrencyExponentMap,
): string {
  const minor = assertSafeMinorUnits(value);
  const { exponent } = currencyExponent(currency, exponents);
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const factor = 10 ** exponent;
  const major = Math.floor(absolute / factor);
  const fraction = absolute % factor;
  const sign = negative ? "-" : "";
  if (exponent === 0) return `${sign}${major}`;
  return `${sign}${major}.${String(fraction).padStart(exponent, "0")}`;
}

export function providerSupportsCurrency(provider: PaymentProvider, currency: unknown): boolean {
  let normalized: string;
  try {
    normalized = normalizeCurrencyCode(currency);
  } catch {
    return false;
  }
  return provider.supportedCurrencies.some((value) => {
    try {
      return normalizeCurrencyCode(value) === normalized;
    } catch {
      return false;
    }
  });
}

export function assertCurrencySupported(currency: unknown, supportedCurrencies: readonly string[]): string {
  const normalized = normalizeCurrencyCode(currency);
  const supported = supportedCurrencies.some((value) => {
    try {
      return normalizeCurrencyCode(value) === normalized;
    } catch {
      return false;
    }
  });
  if (!supported) throw new RangeError(`Payment provider does not support ${normalized}`);
  return normalized;
}

export function selectPaymentProviderForCurrency(
  providers: Iterable<PaymentProvider | undefined>,
  currency: unknown,
): PaymentProvider | null {
  for (const provider of providers) {
    if (provider && providerSupportsCurrency(provider, currency)) return provider;
  }
  return null;
}

export function formatProviderMajorAmount(
  value: number,
  currency: unknown,
  supportedCurrencies: readonly string[],
  exponents: CurrencyExponentMap,
): string {
  const normalized = assertCurrencySupported(currency, supportedCurrencies);
  assertSafeMinorUnits(value, true);
  return minorToMajorString(value, normalized, exponents);
}

export function parseProviderMajorAmount(
  value: string,
  currency: unknown,
  supportedCurrencies: readonly string[],
  exponents: CurrencyExponentMap,
): number {
  const normalized = assertCurrencySupported(currency, supportedCurrencies);
  return assertSafeMinorUnits(parseMajorToMinor(value, normalized, exponents), true);
}
