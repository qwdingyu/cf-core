import { describe, expect, it } from "vitest";
import {
  formatProviderMajorAmount,
  minorToMajorString,
  normalizeCurrencyCode,
  parseMajorToMinor,
  parseProviderMajorAmount,
  providerSupportsCurrency,
  selectPaymentProviderForCurrency,
} from "../currency.js";
import type { PaymentProvider } from "../types.js";

const EXPONENTS = {
  CNY: 2,
  USD: 2,
  JPY: 0,
  USDT: 6,
} as const;

function provider(name: string, supportedCurrencies: string[]): PaymentProvider {
  return {
    name,
    displayName: name,
    supportedCurrencies,
    createPayment: async () => ({}),
    verifyCallback: async () => ({
      orderNo: "order-1",
      providerTradeNo: "trade-1",
      amountCents: 1,
      currency: supportedCurrencies[0] || "CNY",
      paidAt: new Date().toISOString(),
    }),
  };
}

describe("payment currency primitives", () => {
  it("normalizes currency codes without accepting arbitrary labels", () => {
    expect(normalizeCurrencyCode(" cny ")).toBe("CNY");
    expect(normalizeCurrencyCode("USDT")).toBe("USDT");
    expect(() => normalizeCurrencyCode("人民币")).toThrow("Invalid currency code");
    expect(() => normalizeCurrencyCode(123)).toThrow("Invalid currency code");
  });

  it("parses and formats integer minor units using the currency exponent", () => {
    expect(parseMajorToMinor("1.10", "CNY", EXPONENTS)).toBe(110);
    expect(parseMajorToMinor("500", "JPY", EXPONENTS)).toBe(500);
    expect(parseMajorToMinor("1.000001", "USDT", EXPONENTS)).toBe(1_000_001);
    expect(minorToMajorString(-110, "CNY", EXPONENTS)).toBe("-1.10");
    expect(minorToMajorString(500, "JPY", EXPONENTS)).toBe("500");
  });

  it("fails closed for unknown currencies and unsafe major-unit input", () => {
    expect(() => parseMajorToMinor("1.00", "EUR", EXPONENTS)).toThrow("Unsupported currency: EUR");
    expect(() => parseMajorToMinor("1e2", "CNY", EXPONENTS)).toThrow();
    expect(() => parseMajorToMinor("1,000", "CNY", EXPONENTS)).toThrow();
    expect(() => parseMajorToMinor("1.001", "CNY", EXPONENTS)).toThrow();
    expect(() => parseMajorToMinor("1.0", "JPY", EXPONENTS)).toThrow();
    expect(() => parseMajorToMinor(String(Number.MAX_SAFE_INTEGER), "CNY", EXPONENTS)).toThrow();
  });

  it("formats and parses provider amounts only for supported currencies", () => {
    expect(formatProviderMajorAmount(110, "CNY", ["CNY"], EXPONENTS)).toBe("1.10");
    expect(parseProviderMajorAmount("1.10", "CNY", ["CNY"], EXPONENTS)).toBe(110);
    expect(() => formatProviderMajorAmount(110, "USD", ["CNY"], EXPONENTS)).toThrow("does not support USD");
    expect(() => parseProviderMajorAmount("0.00", "CNY", ["CNY"], EXPONENTS)).toThrow("greater than zero");
  });

  it("selects the first provider that explicitly supports the currency", () => {
    const cny = provider("cny", ["CNY"]);
    const global = provider("global", ["USD", "JPY"]);
    expect(providerSupportsCurrency(global, "usd")).toBe(true);
    expect(selectPaymentProviderForCurrency([cny, global], "JPY")).toBe(global);
    expect(selectPaymentProviderForCurrency([cny, global], "EUR")).toBeNull();
    expect(selectPaymentProviderForCurrency([undefined, cny], "CNY")).toBe(cny);
  });
});
