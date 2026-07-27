/** MWK is the base currency. Rates are MWK per 1 unit of foreign currency (e.g. 1750 = 1 USD). */
const DEFAULT_RATES: Record<string, number> = {
  MWK: 1,
  USD: 1750,
  ZAR: 49,
  EUR: 1900,
  GBP: 2200,
  CAD: 1130,
  AUD: 1140,
  NZD: 1050,
  CHF: 2050,
  JPY: 6.25,
  CNY: 121,
  INR: 10.5,
  BRL: 167,
  MXN: 51,
  AED: 243,
  SAR: 231,
  QAR: 243,
  KES: 6.85,
  NGN: 0.59,
  EGP: 18,
  MAD: 88.5,
  TRY: 26.25,
  SGD: 654,
  THB: 25,
  KRW: 0.65,
  SEK: 83,
  NOK: 83,
  BWP: 65,
  ZMW: 33,
  TZS: 0.33,
  UGX: 0.23,
  GHS: 67,
  MUR: 19,
  MZN: 14,
};

const DECIMALS: Record<string, number> = {
  MWK: 0,
  JPY: 0,
  KRW: 0,
  NGN: 0,
  TZS: 0,
  UGX: 0,
};

/** Legacy quotes stored foreign-units-per-MWK (e.g. 0.00113 for USD). */
const LEGACY_FOREIGN_PER_MWK_MAX = 0.05;

export type ExchangeRateOverrides = Record<string, number>;

export function normalizeExchangeRate(rate: number): number {
  if (rate > 0 && rate < LEGACY_FOREIGN_PER_MWK_MAX) {
    return 1 / rate;
  }
  return rate;
}

export function parseQuoteExchangeRates(raw: unknown): ExchangeRateOverrides {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return parseQuoteExchangeRates(JSON.parse(raw));
    } catch {
      return {};
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ExchangeRateOverrides = {};
  for (const [code, rate] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(rate);
    if (Number.isFinite(n) && n > 0) {
      out[code.toUpperCase()] = normalizeExchangeRate(n);
    }
  }
  return out;
}

export function getMwkPerUnit(currencyCode: string, overrides: ExchangeRateOverrides = {}): number {
  const code = currencyCode.toUpperCase();
  if (code === "MWK") return 1;
  if (overrides[code] != null) return overrides[code]!;
  return DEFAULT_RATES[code] ?? 1;
}

/** @deprecated Use getMwkPerUnit */
export const getRateFromMwk = getMwkPerUnit;

/** PayChangu: MWK when customer chose kwacha, USD when USD or any other display currency. */
export function resolvePaymentCurrency(displayCurrency: string): "MWK" | "USD" {
  const code = displayCurrency.toUpperCase();
  if (code === "MWK") return "MWK";
  if (code === "USD") return "USD";
  return "USD";
}

export function convertMwkToCurrency(
  amountMwk: number,
  currencyCode: string,
  overrides: ExchangeRateOverrides = {},
): number {
  const code = currencyCode.toUpperCase();
  if (code === "MWK") return Math.round(amountMwk);

  const mwkPerUnit = getMwkPerUnit(code, overrides);
  const decimals = DECIMALS[code] ?? 2;
  const converted = amountMwk / mwkPerUnit;
  if (decimals === 0) return Math.round(converted);
  return Math.round(converted * 10 ** decimals) / 10 ** decimals;
}

export function formatPayChanguAmount(amount: number, currencyCode: string): string {
  const code = currencyCode.toUpperCase();
  if (code === "MWK" || (DECIMALS[code] ?? 2) === 0) {
    return String(Math.round(amount));
  }
  return amount.toFixed(2);
}

export function formatCurrencyAmount(amount: number, currencyCode: string): string {
  const code = currencyCode.toUpperCase();
  const decimals = DECIMALS[code] ?? 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals === 0 ? 0 : undefined,
  }).format(amount);
}
