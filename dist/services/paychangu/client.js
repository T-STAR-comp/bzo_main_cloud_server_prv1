"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paychangu = exports.PayChanguClient = void 0;
const config_js_1 = require("../../config.js");
const currency_js_1 = require("../currency.js");
const logger_js_1 = require("../../logger.js");
const DEFAULT_OPERATORS = [
    { ref_id: "20be6c20-adeb-4b5b-a7ba-0769820df4fb", name: "Airtel Money", country: "Malawi" },
    { ref_id: "tnm-mpamba-ref", name: "TNM Mpamba", country: "Malawi" },
];
function isSuccessStatus(status) {
    if (!status)
        return false;
    const s = status.toLowerCase();
    return s === "success" || s === "successful" || s === "completed";
}
function isPendingStatus(status) {
    if (!status)
        return true;
    const s = status.toLowerCase();
    return s === "pending" || s === "processing" || s === "initiated";
}
function isFailedStatus(status) {
    if (!status)
        return false;
    const s = status.toLowerCase();
    return s === "failed" || s === "cancelled" || s === "canceled" || s === "declined";
}
function isHostedNotCreatedMessage(message) {
    return /not created|not found|does not exist/i.test(message);
}
class PayChanguClient {
    baseUrl;
    secretKey;
    mockMode;
    constructor() {
        this.baseUrl = config_js_1.config.paychangu.baseUrl.replace(/\/$/, "");
        this.secretKey = config_js_1.config.paychangu.secretKey;
        this.mockMode = !this.secretKey;
        if (this.mockMode) {
            logger_js_1.logger.warn("PayChangu mock mode - set PAYCHANGU_SECRET_KEY for live payments");
        }
    }
    isMockMode() {
        return this.mockMode;
    }
    async request(path, init) {
        const url = `${this.baseUrl}${path}`;
        const res = await fetch(url, {
            ...init,
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${this.secretKey}`,
                ...(init?.body ? { "Content-Type": "application/json" } : {}),
                ...init?.headers,
            },
        });
        const text = await res.text();
        let body = null;
        try {
            body = text ? JSON.parse(text) : null;
        }
        catch {
            body = { raw: text };
        }
        if (!res.ok) {
            const message = body?.message ??
                body?.error ??
                `PayChangu HTTP ${res.status}`;
            throw new Error(message);
        }
        return body;
    }
    async getMobileMoneyOperators() {
        if (this.mockMode)
            return DEFAULT_OPERATORS;
        try {
            const data = await this.request("/mobile-money/");
            const list = data.data ?? data.operators ?? [];
            return list.length ? list : DEFAULT_OPERATORS;
        }
        catch (error) {
            logger_js_1.logger.warn("Failed to fetch PayChangu operators, using defaults", error);
            return DEFAULT_OPERATORS;
        }
    }
    async initMobileMoney(input) {
        if (this.mockMode) {
            return {
                chargeId: input.chargeId,
                refId: `MOCK-${Date.now()}`,
                status: "pending",
                raw: { mock: true },
            };
        }
        const currency = input.currency ?? "MWK";
        const body = await this.request("/mobile-money/payments/initialize", {
            method: "POST",
            body: JSON.stringify({
                mobile: input.mobile,
                mobile_money_operator_ref_id: input.operatorRefId,
                amount: (0, currency_js_1.formatPayChanguAmount)(input.amount, currency),
                currency,
                charge_id: input.chargeId,
                email: input.email,
                first_name: input.firstName,
                last_name: input.lastName,
            }),
        });
        const data = body.data ?? {};
        return {
            chargeId: String(data.charge_id ?? input.chargeId),
            refId: data.ref_id != null ? String(data.ref_id) : undefined,
            status: String(data.status ?? body.status ?? "pending"),
            raw: body,
        };
    }
    async initBankTransfer(input) {
        if (this.mockMode) {
            const expires = new Date(Date.now() + 60 * 60 * 1000);
            return {
                chargeId: input.chargeId,
                refId: `MOCK-BANK-${Date.now()}`,
                status: "pending",
                raw: { mock: true },
                bankDetails: {
                    bankName: "Centenary Bank (Mock)",
                    accountNumber: "2652455380",
                    accountName: "Biazo Travel / PayChangu",
                    expiresAt: expires,
                },
            };
        }
        const currency = input.currency ?? "MWK";
        const body = await this.request("/direct-charge/payments/initialize", {
            method: "POST",
            body: JSON.stringify({
                payment_method: "mobile_bank_transfer",
                amount: (0, currency_js_1.formatPayChanguAmount)(input.amount, currency),
                currency,
                charge_id: input.chargeId,
                create_permanent_account: "false",
            }),
        });
        const details = body.data?.payment_account_details;
        const tx = body.data?.transaction;
        const expiresAt = details?.account_expiration_timestamp
            ? new Date(details.account_expiration_timestamp * 1000)
            : null;
        return {
            chargeId: String(tx?.charge_id ?? input.chargeId),
            refId: tx?.ref_id != null ? String(tx.ref_id) : undefined,
            status: String(tx?.status ?? body.status ?? "pending"),
            raw: body,
            bankDetails: details
                ? {
                    bankName: String(details.bank_name ?? ""),
                    accountNumber: String(details.account_number ?? ""),
                    accountName: String(details.account_name ?? ""),
                    expiresAt,
                }
                : undefined,
        };
    }
    async initCardCharge(input) {
        if (this.mockMode) {
            return {
                chargeId: input.chargeId,
                status: "pending",
                raw: { mock: true },
                card3ds: { requires3ds: false, authUrl: null },
            };
        }
        const body = await this.request("/charge-card/payments", {
            method: "POST",
            body: JSON.stringify({
                card_number: input.cardNumber.replace(/\s/g, ""),
                expiry: input.expiry,
                cvv: input.cvv,
                cardholder_name: input.cardholderName,
                amount: String(Math.round(input.amount)),
                currency: input.currency ?? "MWK",
                email: input.email,
                charge_id: input.chargeId,
                redirect_url: input.redirectUrl,
            }),
        });
        return {
            chargeId: input.chargeId,
            status: body.status ?? (body.success ? "pending" : "failed"),
            raw: body,
            card3ds: {
                requires3ds: Boolean(body.requires_3ds_auth),
                authUrl: body["3ds_auth_link"] ?? null,
                orderReference: body.orderReference,
            },
        };
    }
    async initHostedCheckout(input) {
        if (this.mockMode) {
            const mockTxRef = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const callbackWithParams = `${input.callbackUrl}${input.callbackUrl.includes("?") ? "&" : "?"}tx_ref=${encodeURIComponent(mockTxRef)}&status=success&mock_hosted=1`;
            return {
                chargeId: mockTxRef,
                status: "pending",
                checkoutUrl: callbackWithParams,
                raw: {
                    mock: true,
                    status: "success",
                    message: "Hosted payment session generated successfully.",
                    data: {
                        event: "checkout.session:created",
                        checkout_url: callbackWithParams,
                        data: {
                            tx_ref: mockTxRef,
                            currency: input.currency ?? "MWK",
                            amount: Math.round(input.amount),
                            mode: "sandbox",
                            status: "pending",
                        },
                    },
                },
            };
        }
        const body = await this.request("/payment", {
            method: "POST",
            body: JSON.stringify({
                amount: String(Math.round(input.amount)),
                currency: input.currency ?? "MWK",
                tx_ref: input.txRef,
                email: input.email,
                first_name: input.firstName ?? "Customer",
                last_name: input.lastName ?? "",
                callback_url: input.callbackUrl,
                return_url: input.returnUrl,
                customization: {
                    title: input.title ?? "Biazo Travel Payment",
                    description: input.description ?? "Flight booking payment",
                },
                meta: input.meta,
            }),
        });
        if (body.status && body.status !== "success") {
            throw new Error(body.message ?? "PayChangu could not create checkout session");
        }
        const checkoutUrl = body.data?.checkout_url ?? null;
        const inner = body.data?.data;
        if (!checkoutUrl) {
            throw new Error(body.message ?? "PayChangu did not return a checkout URL");
        }
        return {
            chargeId: String(inner?.tx_ref ?? input.txRef),
            refId: String(inner?.tx_ref ?? input.txRef),
            status: String(inner?.status ?? body.status ?? "pending"),
            checkoutUrl,
            raw: { ...body, checkout_url: checkoutUrl },
        };
    }
    async verifyHostedPayment(chargeId) {
        const url = `${this.baseUrl}/verify-payment/${encodeURIComponent(chargeId)}`;
        const res = await fetch(url, {
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${this.secretKey}`,
            },
        });
        const text = await res.text();
        let body = null;
        try {
            body = text ? JSON.parse(text) : null;
        }
        catch {
            body = { raw: text };
        }
        if (!res.ok) {
            const message = body?.message ??
                body?.error ??
                `PayChangu HTTP ${res.status}`;
            if (isHostedNotCreatedMessage(message)) {
                return { success: false, status: "awaiting_checkout", raw: body };
            }
            throw new Error(message);
        }
        const data = body.data;
        const status = String(data?.status ?? body.status ?? "pending");
        return {
            success: isSuccessStatus(status),
            status,
            refId: data?.reference != null ? String(data.reference) : undefined,
            raw: body,
        };
    }
    async verify(method, chargeId) {
        if (this.mockMode) {
            if (method === "hosted_checkout" || chargeId.startsWith("mock-")) {
                return {
                    success: true,
                    status: "success",
                    refId: `MOCK-REF-${chargeId}`,
                    raw: { mock: true },
                };
            }
            const match = chargeId.match(/BZ-(\d+)-/);
            const created = match ? Number(match[1]) : Date.now();
            const success = Date.now() - created > 8_000;
            return {
                success,
                status: success ? "success" : "pending",
                refId: success ? `MOCK-REF-${chargeId}` : undefined,
                raw: { mock: true },
            };
        }
        if (method === "hosted_checkout") {
            return this.verifyHostedPayment(chargeId);
        }
        if (method === "mobile_money") {
            const body = await this.request(`/mobile-money/payments/${encodeURIComponent(chargeId)}/verify`);
            const data = body.data ?? {};
            const status = String(data.status ?? body.status ?? "pending");
            return { success: isSuccessStatus(status), status, refId: data.ref_id != null ? String(data.ref_id) : undefined, raw: body };
        }
        if (method === "bank") {
            const body = await this.request(`/direct-charge/transactions/${encodeURIComponent(chargeId)}/details`);
            const tx = body.data?.transaction;
            const status = String(tx?.status ?? body.status ?? "pending");
            return {
                success: isSuccessStatus(status),
                status,
                refId: tx?.ref_id != null ? String(tx.ref_id) : undefined,
                raw: body,
            };
        }
        const body = await this.request(`/charge-card/verify/${encodeURIComponent(chargeId)}`);
        const status = String(body.data?.status ?? body.status ?? (body.success ? "success" : "pending"));
        return { success: isSuccessStatus(status), status, raw: body };
    }
    static parseStatus(status) {
        return {
            isSuccess: isSuccessStatus(status),
            isPending: isPendingStatus(status),
            isFailed: isFailedStatus(status),
        };
    }
}
exports.PayChanguClient = PayChanguClient;
exports.paychangu = new PayChanguClient();
