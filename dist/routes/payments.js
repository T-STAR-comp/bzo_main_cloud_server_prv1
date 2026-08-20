"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentsRouter = void 0;
const uuid_1 = require("uuid");
const express_1 = require("express");
const zod_1 = require("zod");
const config_js_1 = require("../config.js");
const pool_js_1 = require("../db/pool.js");
const auth_js_1 = require("../middleware/auth.js");
const errorHandler_js_1 = require("../middleware/errorHandler.js");
const client_js_1 = require("../services/paychangu/client.js");
const applications_js_1 = require("../services/applications.js");
const currency_js_1 = require("../services/currency.js");
const paymentLedger_js_1 = require("../services/paymentLedger.js");
const paymentPoller_js_1 = require("../services/paymentPoller.js");
const travelCredits_js_1 = require("../services/travelCredits.js");
const manualPaymentSources_js_1 = require("../services/manualPaymentSources.js");
const manualPayments_js_1 = require("../services/manualPayments.js");
exports.paymentsRouter = (0, express_1.Router)();
exports.paymentsRouter.use(auth_js_1.authenticate);
exports.paymentsRouter.get("/config", (0, errorHandler_js_1.asyncHandler)(async (_req, res) => {
    const manualSources = config_js_1.config.usePaymentGateway ? [] : await (0, manualPaymentSources_js_1.listManualPaymentSources)(true);
    res.json({
        checkoutMode: config_js_1.config.paychangu.checkoutMode,
        mockMode: client_js_1.paychangu.isMockMode(),
        usePaymentGateway: config_js_1.config.usePaymentGateway,
        manualSources,
    });
}));
exports.paymentsRouter.get("/operators", (0, errorHandler_js_1.asyncHandler)(async (_req, res) => {
    const operators = await client_js_1.paychangu.getMobileMoneyOperators();
    res.json({ operators });
}));
exports.paymentsRouter.get("/application/:applicationId/active", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const applicationId = zod_1.z.string().uuid().parse(req.params.applicationId);
    const row = await (0, paymentLedger_js_1.getActiveLedgerForOrder)("flight_application", applicationId, req.user.id);
    res.json({ payment: row ? (0, paymentLedger_js_1.mapLedgerPublic)(row) : null });
}));
exports.paymentsRouter.get("/return/:txRef", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const txRef = zod_1.z.string().min(1).parse(req.params.txRef);
    const redirectStatus = typeof req.query.status === "string" ? req.query.status : null;
    let row = await (0, paymentLedger_js_1.getLedgerByChargeId)(txRef, req.user.id);
    if (!row)
        throw new errorHandler_js_1.AppError(404, "Payment not found");
    if (row.status === "pending") {
        const result = await (0, paymentLedger_js_1.processHostedCheckoutReturn)(row, redirectStatus);
        row = result.row;
        if (row.status === "pending") {
            (0, paymentPoller_js_1.watchPaymentLedger)(row);
        }
        res.json({
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
            outcome: result.outcome,
            redirectStatus,
            verified: true,
        });
        return;
    }
    res.json({
        payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
        outcome: row.status,
        redirectStatus,
        verified: false,
    });
}));
exports.paymentsRouter.get("/:id", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    let row = await (0, paymentLedger_js_1.getLedgerById)(id, req.user.id);
    if (!row)
        throw new errorHandler_js_1.AppError(404, "Payment not found");
    if (row.status === "pending") {
        if (row.payment_method !== "manual_transfer") {
            await (0, paymentLedger_js_1.verifyAndProcessLedger)(row);
        }
        row = (await (0, paymentLedger_js_1.getLedgerById)(id, req.user.id));
    }
    res.json({ payment: (0, paymentLedger_js_1.mapLedgerPublic)(row) });
}));
const displayCurrencyField = zod_1.z.string().length(3).default("MWK");
const mobileMoneySchema = zod_1.z.object({
    method: zod_1.z.literal("mobile_money"),
    applicationId: zod_1.z.string().uuid(),
    mobile: zod_1.z.string().min(9).max(20),
    operatorRefId: zod_1.z.string().min(1),
    displayCurrency: displayCurrencyField,
});
const bankSchema = zod_1.z.object({
    method: zod_1.z.literal("bank"),
    applicationId: zod_1.z.string().uuid(),
    displayCurrency: displayCurrencyField,
});
const cardSchema = zod_1.z.object({
    method: zod_1.z.literal("card"),
    applicationId: zod_1.z.string().uuid(),
    cardNumber: zod_1.z.string().min(12).max(19),
    expiry: zod_1.z.string().regex(/^\d{2}\/\d{2,4}$/),
    cvv: zod_1.z.string().min(3).max(4),
    cardholderName: zod_1.z.string().min(2).max(200),
    redirectUrl: zod_1.z.string().url().optional(),
    displayCurrency: displayCurrencyField,
});
const hostedSchema = zod_1.z.object({
    method: zod_1.z.literal("hosted_checkout"),
    applicationId: zod_1.z.string().uuid(),
    displayCurrency: displayCurrencyField,
});
const initiateSchema = zod_1.z.discriminatedUnion("method", [
    mobileMoneySchema,
    bankSchema,
    cardSchema,
    hostedSchema,
]);
async function resolvePaymentAmounts(applicationId, userId, amountMwk, displayCurrency) {
    const loaded = await (0, applications_js_1.loadApplication)(applicationId);
    if (!loaded || loaded.raw.user_id !== userId) {
        throw new errorHandler_js_1.AppError(404, "Application not found");
    }
    const rateOverrides = (0, currency_js_1.parseQuoteExchangeRates)(loaded.raw.quote_exchange_rates);
    const display = displayCurrency.toUpperCase();
    const paymentCurrency = (0, currency_js_1.resolvePaymentCurrency)(display);
    const paymentAmount = (0, currency_js_1.convertMwkToCurrency)(amountMwk, paymentCurrency, rateOverrides);
    return { displayCurrency: display, paymentCurrency, paymentAmount };
}
async function resolveCreditPurchasePayment(amountMwk, displayCurrency) {
    const display = displayCurrency.toUpperCase();
    const paymentCurrency = (0, currency_js_1.resolvePaymentCurrency)(display);
    const paymentAmount = (0, currency_js_1.convertMwkToCurrency)(amountMwk, paymentCurrency, {});
    return { displayCurrency: display, paymentCurrency, paymentAmount };
}
exports.paymentsRouter.get("/travel-credits/active", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const row = await (0, paymentLedger_js_1.getActiveCreditPurchaseLedger)(req.user.id);
    res.json({ payment: row ? (0, paymentLedger_js_1.mapLedgerPublic)(row) : null });
}));
const creditAmountSchema = zod_1.z.number().int().positive().min(1000).max(50_000_000);
const creditPurchaseHostedSchema = zod_1.z.object({
    method: zod_1.z.literal("hosted_checkout"),
    amountMwk: creditAmountSchema,
    displayCurrency: displayCurrencyField,
});
const creditPurchaseMobileSchema = zod_1.z.object({
    method: zod_1.z.literal("mobile_money"),
    amountMwk: creditAmountSchema,
    displayCurrency: displayCurrencyField,
    mobile: zod_1.z.string().min(9).max(20),
    operatorRefId: zod_1.z.string().min(1),
});
const creditPurchaseBankSchema = zod_1.z.object({
    method: zod_1.z.literal("bank"),
    amountMwk: creditAmountSchema,
    displayCurrency: displayCurrencyField,
});
const creditPurchaseCardSchema = zod_1.z.object({
    method: zod_1.z.literal("card"),
    amountMwk: creditAmountSchema,
    displayCurrency: displayCurrencyField,
    cardNumber: zod_1.z.string().min(12).max(19),
    expiry: zod_1.z.string().regex(/^\d{2}\/\d{2,4}$/),
    cvv: zod_1.z.string().min(3).max(4),
    cardholderName: zod_1.z.string().min(2).max(200),
    redirectUrl: zod_1.z.string().url().optional(),
});
const creditPurchaseSchema = zod_1.z.discriminatedUnion("method", [
    creditPurchaseHostedSchema,
    creditPurchaseMobileSchema,
    creditPurchaseBankSchema,
    creditPurchaseCardSchema,
]);
exports.paymentsRouter.post("/travel-credits/purchase", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = creditPurchaseSchema.parse(req.body);
    const userId = req.user.id;
    const existing = await (0, paymentLedger_js_1.getActiveCreditPurchaseLedger)(userId);
    if (existing) {
        const mapped = (0, paymentLedger_js_1.mapLedgerPublic)(existing);
        res.json({
            payment: mapped,
            checkoutUrl: mapped.checkoutUrl ?? undefined,
            resumed: true,
        });
        if (existing.payment_method !== "hosted_checkout" || (0, paymentLedger_js_1.hostedCheckoutReadyForVerify)(existing)) {
            (0, paymentPoller_js_1.watchPaymentLedger)(existing);
        }
        return;
    }
    const amountMwk = body.amountMwk;
    const { displayCurrency, paymentCurrency, paymentAmount } = await resolveCreditPurchasePayment(amountMwk, body.displayCurrency);
    const purchaseId = (0, uuid_1.v4)();
    const orderSnapshot = {
        type: "travel_credit_purchase",
        purchaseId,
        amountMwk,
        displayCurrency,
        paymentCurrency,
        paymentAmount,
    };
    const checkoutMode = config_js_1.config.paychangu.checkoutMode;
    if (body.method === "hosted_checkout" && checkoutMode !== "hosted") {
        throw new errorHandler_js_1.AppError(400, "Hosted checkout is not enabled");
    }
    if (body.method !== "hosted_checkout" && checkoutMode === "hosted") {
        throw new errorHandler_js_1.AppError(400, "Direct charge is not enabled - use hosted checkout");
    }
    const [users] = await pool_js_1.pool.execute(`SELECT first_name, last_name, email FROM users WHERE id = :id`, { id: userId });
    const user = users[0];
    const chargeId = (0, paymentLedger_js_1.generateChargeId)();
    const clientOrigin = config_js_1.config.clientOrigins[0] ?? "http://localhost:3000";
    if (body.method === "hosted_checkout") {
        const callbackUrl = `${clientOrigin}/dashboard?creditPurchase=callback`;
        const returnUrl = `${clientOrigin}/dashboard?creditPurchase=cancel`;
        const init = await client_js_1.paychangu.initHostedCheckout({
            txRef: chargeId,
            amount: paymentAmount,
            currency: paymentCurrency,
            email: user?.email,
            firstName: user?.first_name,
            lastName: user?.last_name,
            callbackUrl,
            returnUrl,
            title: "Biazo · Travel credit",
            description: `Purchase MWK ${amountMwk.toLocaleString()} travel credit`,
            meta: { purchaseId, clientReference: chargeId, type: "travel_credit_purchase" },
        });
        const row = await (0, paymentLedger_js_1.createLedgerEntry)({
            userId,
            orderType: "travel_credit_purchase",
            orderId: purchaseId,
            chargeId: init.chargeId,
            paymentMethod: "hosted_checkout",
            amountMwk,
            paymentAmount,
            currency: paymentCurrency,
            displayCurrency,
            orderSnapshot: { ...orderSnapshot, clientReference: chargeId },
            paychanguRefId: init.chargeId,
            paychanguStatus: init.status,
            providerResponse: init.raw,
        });
        res.status(201).json({
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
            checkoutUrl: init.checkoutUrl,
            message: "Redirecting to PayChangu secure checkout…",
        });
        return;
    }
    if (body.method === "mobile_money") {
        const operators = await client_js_1.paychangu.getMobileMoneyOperators();
        const operator = operators.find((o) => o.ref_id === body.operatorRefId);
        const init = await client_js_1.paychangu.initMobileMoney({
            chargeId,
            amount: paymentAmount,
            currency: paymentCurrency,
            mobile: body.mobile,
            operatorRefId: body.operatorRefId,
            email: user?.email,
            firstName: user?.first_name,
            lastName: user?.last_name,
        });
        const row = await (0, paymentLedger_js_1.createLedgerEntry)({
            userId,
            orderType: "travel_credit_purchase",
            orderId: purchaseId,
            chargeId: init.chargeId,
            paymentMethod: "mobile_money",
            amountMwk,
            paymentAmount,
            currency: paymentCurrency,
            displayCurrency,
            orderSnapshot,
            paychanguRefId: init.refId,
            paychanguStatus: init.status,
            providerResponse: init.raw,
            mobileNumber: body.mobile,
            mobileOperatorRefId: body.operatorRefId,
            mobileOperatorName: operator?.name,
        });
        (0, paymentPoller_js_1.watchPaymentLedger)(row);
        res.status(201).json({
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
            message: "PIN prompt sent - approve the payment on your phone.",
        });
        return;
    }
    if (body.method === "bank") {
        const init = await client_js_1.paychangu.initBankTransfer({
            chargeId,
            amount: paymentAmount,
            currency: paymentCurrency,
        });
        const row = await (0, paymentLedger_js_1.createLedgerEntry)({
            userId,
            orderType: "travel_credit_purchase",
            orderId: purchaseId,
            chargeId: init.chargeId,
            paymentMethod: "bank",
            amountMwk,
            paymentAmount,
            currency: paymentCurrency,
            displayCurrency,
            orderSnapshot,
            paychanguRefId: init.refId,
            paychanguStatus: init.status,
            providerResponse: init.raw,
            bankDetails: init.bankDetails,
        });
        (0, paymentPoller_js_1.watchPaymentLedger)(row);
        res.status(201).json({
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
            message: "Transfer to the account details shown. We will confirm automatically.",
        });
        return;
    }
    const redirectUrl = body.redirectUrl ?? `${clientOrigin}/dashboard?creditPurchase=callback`;
    const init = await client_js_1.paychangu.initCardCharge({
        chargeId,
        amount: paymentAmount,
        currency: paymentCurrency,
        cardNumber: body.cardNumber,
        expiry: body.expiry,
        cvv: body.cvv,
        cardholderName: body.cardholderName,
        email: user?.email,
        redirectUrl,
    });
    const row = await (0, paymentLedger_js_1.createLedgerEntry)({
        userId,
        orderType: "travel_credit_purchase",
        orderId: purchaseId,
        chargeId: init.chargeId,
        paymentMethod: "card",
        amountMwk,
        paymentAmount,
        currency: paymentCurrency,
        displayCurrency,
        orderSnapshot,
        paychanguStatus: init.status,
        providerResponse: init.raw,
        card3ds: init.card3ds,
    });
    (0, paymentPoller_js_1.watchPaymentLedger)(row);
    if (init.card3ds?.requires3ds && init.card3ds.authUrl) {
        res.status(201).json({
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
            requires3ds: true,
            redirectUrl: init.card3ds.authUrl,
            message: "Complete 3D Secure authentication to finish payment.",
        });
        return;
    }
    res.status(201).json({
        payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
        message: "Card charge initiated - confirming payment…",
    });
}));
exports.paymentsRouter.post("/manual/initiate", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = zod_1.z
        .object({
        applicationId: zod_1.z.string().uuid(),
        displayCurrency: displayCurrencyField,
    })
        .parse(req.body);
    const row = await (0, manualPayments_js_1.initiateManualApplicationPayment)(req.user.id, body.applicationId, body.displayCurrency);
    res.status(201).json({
        payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
        message: "Transfer the exact amount to one of the accounts shown, using the reference provided.",
    });
}));
const proofSchema = zod_1.z.object({
    fileName: zod_1.z.string().min(1).max(255),
    mimeType: zod_1.z.string().min(1).max(100),
    fileBase64: zod_1.z.string().min(1),
});
exports.paymentsRouter.post("/manual/:id/proof", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const ledgerId = zod_1.z.string().uuid().parse(req.params.id);
    const body = proofSchema.parse(req.body);
    const buffer = Buffer.from(body.fileBase64, "base64");
    const row = await (0, manualPayments_js_1.submitManualPaymentProof)(req.user.id, ledgerId, body.fileName, body.mimeType, buffer);
    res.status(201).json({
        payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
        message: "Proof submitted. Our team will review it shortly.",
    });
}));
exports.paymentsRouter.post("/travel-credit", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = zod_1.z
        .object({
        applicationId: zod_1.z.string().uuid(),
        displayCurrency: zod_1.z.string().length(3).default("MWK"),
    })
        .parse(req.body);
    const result = await (0, travelCredits_js_1.payApplicationWithTravelCredit)(req.user.id, body.applicationId, body.displayCurrency);
    res.status(201).json(result);
}));
exports.paymentsRouter.post("/initiate", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const body = initiateSchema.parse(req.body);
    const userId = req.user.id;
    if (!config_js_1.config.usePaymentGateway) {
        throw new errorHandler_js_1.AppError(400, "Online payment is disabled. Pay by bank transfer using the instructions on your quote.");
    }
    const existing = await (0, paymentLedger_js_1.getActiveLedgerForOrder)("flight_application", body.applicationId, userId);
    if (existing) {
        const mapped = (0, paymentLedger_js_1.mapLedgerPublic)(existing);
        res.json({
            payment: mapped,
            checkoutUrl: mapped.checkoutUrl ?? undefined,
            resumed: true,
        });
        if (existing.payment_method !== "hosted_checkout" || (0, paymentLedger_js_1.hostedCheckoutReadyForVerify)(existing)) {
            (0, paymentPoller_js_1.watchPaymentLedger)(existing);
        }
        return;
    }
    const snapshot = await (0, paymentLedger_js_1.buildApplicationOrderSnapshot)(body.applicationId, userId);
    const amountMwk = Number(snapshot.amountMwk);
    if (amountMwk <= 0)
        throw new errorHandler_js_1.AppError(400, "Invalid payment amount");
    const { displayCurrency, paymentCurrency, paymentAmount } = await resolvePaymentAmounts(body.applicationId, userId, amountMwk, body.displayCurrency);
    const enrichedSnapshot = {
        ...snapshot,
        displayCurrency,
        paymentCurrency,
        paymentAmount,
    };
    const checkoutMode = config_js_1.config.paychangu.checkoutMode;
    if (body.method === "hosted_checkout" && checkoutMode !== "hosted") {
        throw new errorHandler_js_1.AppError(400, "Hosted checkout is not enabled");
    }
    if (body.method !== "hosted_checkout" && checkoutMode === "hosted") {
        throw new errorHandler_js_1.AppError(400, "Direct charge is not enabled - use hosted checkout");
    }
    const [users] = await pool_js_1.pool.execute(`SELECT first_name, last_name, email FROM users WHERE id = :id`, { id: userId });
    const user = users[0];
    const chargeId = (0, paymentLedger_js_1.generateChargeId)();
    const clientOrigin = config_js_1.config.clientOrigins[0] ?? "http://localhost:3000";
    if (body.method === "hosted_checkout") {
        // callback_url = PayChangu redirect after successful payment (appends tx_ref + status)
        // return_url = PayChangu redirect after cancel / failed attempts (appends tx_ref + status=failed)
        const callbackUrl = `${clientOrigin}/dashboard/applications?applicationId=${body.applicationId}&hosted=callback`;
        const returnUrl = `${clientOrigin}/dashboard/applications?applicationId=${body.applicationId}&hosted=cancel`;
        const init = await client_js_1.paychangu.initHostedCheckout({
            txRef: chargeId,
            amount: paymentAmount,
            currency: paymentCurrency,
            email: user?.email,
            firstName: user?.first_name,
            lastName: user?.last_name,
            callbackUrl,
            returnUrl,
            title: `Biazo · ${snapshot.referenceNumber}`,
            description: `${snapshot.originCity} → ${snapshot.destinationCity}`,
            meta: { applicationId: body.applicationId, clientReference: chargeId },
        });
        const row = await (0, paymentLedger_js_1.createLedgerEntry)({
            userId,
            orderType: "flight_application",
            orderId: body.applicationId,
            chargeId: init.chargeId,
            paymentMethod: "hosted_checkout",
            amountMwk,
            paymentAmount,
            currency: paymentCurrency,
            displayCurrency,
            orderSnapshot: { ...enrichedSnapshot, clientReference: chargeId },
            paychanguRefId: init.chargeId,
            paychanguStatus: init.status,
            providerResponse: init.raw,
        });
        res.status(201).json({
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
            checkoutUrl: init.checkoutUrl,
            message: "Redirecting to PayChangu secure checkout…",
        });
        return;
    }
    if (body.method === "mobile_money") {
        const operators = await client_js_1.paychangu.getMobileMoneyOperators();
        const operator = operators.find((o) => o.ref_id === body.operatorRefId);
        const init = await client_js_1.paychangu.initMobileMoney({
            chargeId,
            amount: paymentAmount,
            currency: paymentCurrency,
            mobile: body.mobile,
            operatorRefId: body.operatorRefId,
            email: user?.email,
            firstName: user?.first_name,
            lastName: user?.last_name,
        });
        const row = await (0, paymentLedger_js_1.createLedgerEntry)({
            userId,
            orderType: "flight_application",
            orderId: body.applicationId,
            chargeId: init.chargeId,
            paymentMethod: "mobile_money",
            amountMwk,
            paymentAmount,
            currency: paymentCurrency,
            displayCurrency,
            orderSnapshot: enrichedSnapshot,
            paychanguRefId: init.refId,
            paychanguStatus: init.status,
            providerResponse: init.raw,
            mobileNumber: body.mobile,
            mobileOperatorRefId: body.operatorRefId,
            mobileOperatorName: operator?.name,
        });
        (0, paymentPoller_js_1.watchPaymentLedger)(row);
        res.status(201).json({
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
            message: "PIN prompt sent - approve the payment on your phone.",
        });
        return;
    }
    if (body.method === "bank") {
        const init = await client_js_1.paychangu.initBankTransfer({
            chargeId,
            amount: paymentAmount,
            currency: paymentCurrency,
        });
        const row = await (0, paymentLedger_js_1.createLedgerEntry)({
            userId,
            orderType: "flight_application",
            orderId: body.applicationId,
            chargeId: init.chargeId,
            paymentMethod: "bank",
            amountMwk,
            paymentAmount,
            currency: paymentCurrency,
            displayCurrency,
            orderSnapshot: enrichedSnapshot,
            paychanguRefId: init.refId,
            paychanguStatus: init.status,
            providerResponse: init.raw,
            bankDetails: init.bankDetails,
        });
        (0, paymentPoller_js_1.watchPaymentLedger)(row);
        res.status(201).json({
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
            message: "Transfer to the account details shown. We will confirm automatically.",
        });
        return;
    }
    const redirectUrl = body.redirectUrl ??
        `${clientOrigin}/dashboard/applications?applicationId=${body.applicationId}`;
    const init = await client_js_1.paychangu.initCardCharge({
        chargeId,
        amount: paymentAmount,
        currency: paymentCurrency,
        cardNumber: body.cardNumber,
        expiry: body.expiry,
        cvv: body.cvv,
        cardholderName: body.cardholderName,
        email: user?.email,
        redirectUrl,
    });
    const row = await (0, paymentLedger_js_1.createLedgerEntry)({
        userId,
        orderType: "flight_application",
        orderId: body.applicationId,
        chargeId: init.chargeId,
        paymentMethod: "card",
        amountMwk,
        paymentAmount,
        currency: paymentCurrency,
        displayCurrency,
        orderSnapshot: enrichedSnapshot,
        paychanguStatus: init.status,
        providerResponse: init.raw,
        card3ds: init.card3ds,
    });
    (0, paymentPoller_js_1.watchPaymentLedger)(row);
    if (init.card3ds?.requires3ds && init.card3ds.authUrl) {
        res.status(201).json({
            payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
            requires3ds: true,
            redirectUrl: init.card3ds.authUrl,
            message: "Complete 3D Secure authentication to finish payment.",
        });
        return;
    }
    res.status(201).json({
        payment: (0, paymentLedger_js_1.mapLedgerPublic)(row),
        message: "Card charge initiated - confirming payment…",
    });
}));
exports.paymentsRouter.post("/:id/verify", (0, errorHandler_js_1.asyncHandler)(async (req, res) => {
    const id = zod_1.z.string().uuid().parse(req.params.id);
    const row = await (0, paymentLedger_js_1.getLedgerById)(id, req.user.id);
    if (!row)
        throw new errorHandler_js_1.AppError(404, "Payment not found");
    const outcome = await (0, paymentLedger_js_1.verifyAndProcessLedger)(row);
    const updated = await (0, paymentLedger_js_1.getLedgerById)(id, req.user.id);
    res.json({ payment: (0, paymentLedger_js_1.mapLedgerPublic)(updated), outcome });
}));
