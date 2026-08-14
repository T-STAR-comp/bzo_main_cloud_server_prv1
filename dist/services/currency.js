"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRateFromMwk = void 0;
exports.normalizeExchangeRate = normalizeExchangeRate;
exports.parseQuoteExchangeRates = parseQuoteExchangeRates;
exports.getMwkPerUnit = getMwkPerUnit;
exports.resolvePaymentCurrency = resolvePaymentCurrency;
exports.convertMwkToCurrency = convertMwkToCurrency;
exports.formatPayChanguAmount = formatPayChanguAmount;
exports.formatCurrencyAmount = formatCurrencyAmount;
/** MWK is the base currency. Rates are MWK per 1 unit of foreign currency (e.g. 1750 = 1 USD). */
const DEFAULT_RATES = {
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
const DECIMALS = {
    MWK: 0,
    JPY: 0,
    KRW: 0,
    NGN: 0,
    TZS: 0,
    UGX: 0,
};
/** Legacy quotes stored foreign-units-per-MWK (e.g. 0.00113 for USD). */
const LEGACY_FOREIGN_PER_MWK_MAX = 0.05;
function normalizeExchangeRate(rate) {
    if (rate > 0 && rate < LEGACY_FOREIGN_PER_MWK_MAX) {
        return 1 / rate;
    }
    return rate;
}
function parseQuoteExchangeRates(raw) {
    if (!raw)
        return {};
    if (typeof raw === "string") {
        try {
            return parseQuoteExchangeRates(JSON.parse(raw));
        }
        catch {
            return {};
        }
    }
    if (typeof raw !== "object" || Array.isArray(raw))
        return {};
    const out = {};
    for (const [code, rate] of Object.entries(raw)) {
        const n = Number(rate);
        if (Number.isFinite(n) && n > 0) {
            out[code.toUpperCase()] = normalizeExchangeRate(n);
        }
    }
    return out;
}
function getMwkPerUnit(currencyCode, overrides = {}) {
    const code = currencyCode.toUpperCase();
    if (code === "MWK")
        return 1;
    if (overrides[code] != null)
        return overrides[code];
    return DEFAULT_RATES[code] ?? 1;
}
/** @deprecated Use getMwkPerUnit */
exports.getRateFromMwk = getMwkPerUnit;
/** PayChangu: MWK when customer chose kwacha, USD when USD or any other display currency. */
function resolvePaymentCurrency(displayCurrency) {
    const code = displayCurrency.toUpperCase();
    if (code === "MWK")
        return "MWK";
    if (code === "USD")
        return "USD";
    return "USD";
}
function convertMwkToCurrency(amountMwk, currencyCode, overrides = {}) {
    const code = currencyCode.toUpperCase();
    if (code === "MWK")
        return Math.round(amountMwk);
    const mwkPerUnit = getMwkPerUnit(code, overrides);
    const decimals = DECIMALS[code] ?? 2;
    const converted = amountMwk / mwkPerUnit;
    if (decimals === 0)
        return Math.round(converted);
    return Math.round(converted * 10 ** decimals) / 10 ** decimals;
}
function formatPayChanguAmount(amount, currencyCode) {
    const code = currencyCode.toUpperCase();
    if (code === "MWK" || (DECIMALS[code] ?? 2) === 0) {
        return String(Math.round(amount));
    }
    return amount.toFixed(2);
}
function formatCurrencyAmount(amount, currencyCode) {
    const code = currencyCode.toUpperCase();
    const decimals = DECIMALS[code] ?? 2;
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
        maximumFractionDigits: decimals,
        minimumFractionDigits: decimals === 0 ? 0 : undefined,
    }).format(amount);
}
