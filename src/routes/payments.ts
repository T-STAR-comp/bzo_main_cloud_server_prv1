import { v4 as uuid } from "uuid";
import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { authenticate, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler, AppError } from "../middleware/errorHandler.js";
import { paychangu } from "../services/paychangu/client.js";
import { loadApplication } from "../services/applications.js";
import {
  convertMwkToCurrency,
  parseQuoteExchangeRates,
  resolvePaymentCurrency,
} from "../services/currency.js";
import {
  buildApplicationOrderSnapshot,
  createLedgerEntry,
  generateChargeId,
  getActiveCreditPurchaseLedger,
  getActiveLedgerForOrder,
  getLedgerByChargeId,
  getLedgerById,
  hostedCheckoutReadyForVerify,
  mapLedgerPublic,
  processHostedCheckoutReturn,
  verifyAndProcessLedger,
} from "../services/paymentLedger.js";
import { watchPaymentLedger } from "../services/paymentPoller.js";
import { payApplicationWithTravelCredit } from "../services/travelCredits.js";
import { listManualPaymentSources } from "../services/manualPaymentSources.js";
import {
  initiateManualApplicationPayment,
  submitManualPaymentProof,
} from "../services/manualPayments.js";

export const paymentsRouter = Router();

paymentsRouter.use(authenticate);

paymentsRouter.get(
  "/config",
  asyncHandler(async (_req, res) => {
    const manualSources = config.usePaymentGateway ? [] : await listManualPaymentSources(true);
    res.json({
      checkoutMode: config.paychangu.checkoutMode,
      mockMode: paychangu.isMockMode(),
      usePaymentGateway: config.usePaymentGateway,
      manualSources,
    });
  }),
);

paymentsRouter.get(
  "/operators",
  asyncHandler(async (_req, res) => {
    const operators = await paychangu.getMobileMoneyOperators();
    res.json({ operators });
  }),
);

paymentsRouter.get(
  "/application/:applicationId/active",
  asyncHandler(async (req: AuthedRequest, res) => {
    const applicationId = z.string().uuid().parse(req.params.applicationId);
    const row = await getActiveLedgerForOrder("flight_application", applicationId, req.user!.id);
    res.json({ payment: row ? mapLedgerPublic(row) : null });
  }),
);

paymentsRouter.get(
  "/return/:txRef",
  asyncHandler(async (req: AuthedRequest, res) => {
    const txRef = z.string().min(1).parse(req.params.txRef);
    const redirectStatus =
      typeof req.query.status === "string" ? req.query.status : null;

    let row = await getLedgerByChargeId(txRef, req.user!.id);
    if (!row) throw new AppError(404, "Payment not found");

    if (row.status === "pending") {
      const result = await processHostedCheckoutReturn(row, redirectStatus);
      row = result.row;
      if (row.status === "pending") {
        watchPaymentLedger(row);
      }
      res.json({
        payment: mapLedgerPublic(row),
        outcome: result.outcome,
        redirectStatus,
        verified: true,
      });
      return;
    }

    res.json({
      payment: mapLedgerPublic(row),
      outcome: row.status,
      redirectStatus,
      verified: false,
    });
  }),
);

paymentsRouter.get(
  "/:id",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    let row = await getLedgerById(id, req.user!.id);
    if (!row) throw new AppError(404, "Payment not found");

    if (row.status === "pending") {
      if (row.payment_method !== "manual_transfer") {
        await verifyAndProcessLedger(row);
      }
      row = (await getLedgerById(id, req.user!.id))!;
    }

    res.json({ payment: mapLedgerPublic(row) });
  }),
);

const displayCurrencyField = z.string().length(3).default("MWK");

const mobileMoneySchema = z.object({
  method: z.literal("mobile_money"),
  applicationId: z.string().uuid(),
  mobile: z.string().min(9).max(20),
  operatorRefId: z.string().min(1),
  displayCurrency: displayCurrencyField,
});

const bankSchema = z.object({
  method: z.literal("bank"),
  applicationId: z.string().uuid(),
  displayCurrency: displayCurrencyField,
});

const cardSchema = z.object({
  method: z.literal("card"),
  applicationId: z.string().uuid(),
  cardNumber: z.string().min(12).max(19),
  expiry: z.string().regex(/^\d{2}\/\d{2,4}$/),
  cvv: z.string().min(3).max(4),
  cardholderName: z.string().min(2).max(200),
  redirectUrl: z.string().url().optional(),
  displayCurrency: displayCurrencyField,
});

const hostedSchema = z.object({
  method: z.literal("hosted_checkout"),
  applicationId: z.string().uuid(),
  displayCurrency: displayCurrencyField,
});

const initiateSchema = z.discriminatedUnion("method", [
  mobileMoneySchema,
  bankSchema,
  cardSchema,
  hostedSchema,
]);

async function resolvePaymentAmounts(
  applicationId: string,
  userId: string,
  amountMwk: number,
  displayCurrency: string,
) {
  const loaded = await loadApplication(applicationId);
  if (!loaded || loaded.raw.user_id !== userId) {
    throw new AppError(404, "Application not found");
  }
  const rateOverrides = parseQuoteExchangeRates(loaded.raw.quote_exchange_rates);
  const display = displayCurrency.toUpperCase();
  const paymentCurrency = resolvePaymentCurrency(display);
  const paymentAmount = convertMwkToCurrency(amountMwk, paymentCurrency, rateOverrides);
  return { displayCurrency: display, paymentCurrency, paymentAmount };
}

async function resolveCreditPurchasePayment(amountMwk: number, displayCurrency: string) {
  const display = displayCurrency.toUpperCase();
  const paymentCurrency = resolvePaymentCurrency(display);
  const paymentAmount = convertMwkToCurrency(amountMwk, paymentCurrency, {});
  return { displayCurrency: display, paymentCurrency, paymentAmount };
}

paymentsRouter.get(
  "/travel-credits/active",
  asyncHandler(async (req: AuthedRequest, res) => {
    const row = await getActiveCreditPurchaseLedger(req.user!.id);
    res.json({ payment: row ? mapLedgerPublic(row) : null });
  }),
);

const creditAmountSchema = z.number().int().positive().min(1000).max(50_000_000);

const creditPurchaseHostedSchema = z.object({
  method: z.literal("hosted_checkout"),
  amountMwk: creditAmountSchema,
  displayCurrency: displayCurrencyField,
});

const creditPurchaseMobileSchema = z.object({
  method: z.literal("mobile_money"),
  amountMwk: creditAmountSchema,
  displayCurrency: displayCurrencyField,
  mobile: z.string().min(9).max(20),
  operatorRefId: z.string().min(1),
});

const creditPurchaseBankSchema = z.object({
  method: z.literal("bank"),
  amountMwk: creditAmountSchema,
  displayCurrency: displayCurrencyField,
});

const creditPurchaseCardSchema = z.object({
  method: z.literal("card"),
  amountMwk: creditAmountSchema,
  displayCurrency: displayCurrencyField,
  cardNumber: z.string().min(12).max(19),
  expiry: z.string().regex(/^\d{2}\/\d{2,4}$/),
  cvv: z.string().min(3).max(4),
  cardholderName: z.string().min(2).max(200),
  redirectUrl: z.string().url().optional(),
});

const creditPurchaseSchema = z.discriminatedUnion("method", [
  creditPurchaseHostedSchema,
  creditPurchaseMobileSchema,
  creditPurchaseBankSchema,
  creditPurchaseCardSchema,
]);

paymentsRouter.post(
  "/travel-credits/purchase",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = creditPurchaseSchema.parse(req.body);
    const userId = req.user!.id;

    const existing = await getActiveCreditPurchaseLedger(userId);
    if (existing) {
      const mapped = mapLedgerPublic(existing);
      res.json({
        payment: mapped,
        checkoutUrl: mapped.checkoutUrl ?? undefined,
        resumed: true,
      });
      if (existing.payment_method !== "hosted_checkout" || hostedCheckoutReadyForVerify(existing)) {
        watchPaymentLedger(existing);
      }
      return;
    }

    const amountMwk = body.amountMwk;
    const { displayCurrency, paymentCurrency, paymentAmount } = await resolveCreditPurchasePayment(
      amountMwk,
      body.displayCurrency,
    );

    const purchaseId = uuid();
    const orderSnapshot = {
      type: "travel_credit_purchase",
      purchaseId,
      amountMwk,
      displayCurrency,
      paymentCurrency,
      paymentAmount,
    };

    const checkoutMode = config.paychangu.checkoutMode;
    if (body.method === "hosted_checkout" && checkoutMode !== "hosted") {
      throw new AppError(400, "Hosted checkout is not enabled");
    }
    if (body.method !== "hosted_checkout" && checkoutMode === "hosted") {
      throw new AppError(400, "Direct charge is not enabled — use hosted checkout");
    }

    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name, email FROM users WHERE id = :id`,
      { id: userId },
    );
    const user = users[0];
    const chargeId = generateChargeId();
    const clientOrigin = config.clientOrigins[0] ?? "http://localhost:3000";

    if (body.method === "hosted_checkout") {
      const callbackUrl = `${clientOrigin}/dashboard?creditPurchase=callback`;
      const returnUrl = `${clientOrigin}/dashboard?creditPurchase=cancel`;

      const init = await paychangu.initHostedCheckout({
        txRef: chargeId,
        amount: paymentAmount,
        currency: paymentCurrency,
        email: user?.email as string | undefined,
        firstName: user?.first_name as string | undefined,
        lastName: user?.last_name as string | undefined,
        callbackUrl,
        returnUrl,
        title: "Biazo · Travel credit",
        description: `Purchase MWK ${amountMwk.toLocaleString()} travel credit`,
        meta: { purchaseId, clientReference: chargeId, type: "travel_credit_purchase" },
      });

      const row = await createLedgerEntry({
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
        payment: mapLedgerPublic(row),
        checkoutUrl: init.checkoutUrl,
        message: "Redirecting to PayChangu secure checkout…",
      });
      return;
    }

    if (body.method === "mobile_money") {
      const operators = await paychangu.getMobileMoneyOperators();
      const operator = operators.find((o) => o.ref_id === body.operatorRefId);

      const init = await paychangu.initMobileMoney({
        chargeId,
        amount: paymentAmount,
        currency: paymentCurrency,
        mobile: body.mobile,
        operatorRefId: body.operatorRefId,
        email: user?.email as string | undefined,
        firstName: user?.first_name as string | undefined,
        lastName: user?.last_name as string | undefined,
      });

      const row = await createLedgerEntry({
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

      watchPaymentLedger(row);
      res.status(201).json({
        payment: mapLedgerPublic(row),
        message: "PIN prompt sent — approve the payment on your phone.",
      });
      return;
    }

    if (body.method === "bank") {
      const init = await paychangu.initBankTransfer({
        chargeId,
        amount: paymentAmount,
        currency: paymentCurrency,
      });

      const row = await createLedgerEntry({
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

      watchPaymentLedger(row);
      res.status(201).json({
        payment: mapLedgerPublic(row),
        message: "Transfer to the account details shown. We will confirm automatically.",
      });
      return;
    }

    const redirectUrl = body.redirectUrl ?? `${clientOrigin}/dashboard?creditPurchase=callback`;

    const init = await paychangu.initCardCharge({
      chargeId,
      amount: paymentAmount,
      currency: paymentCurrency,
      cardNumber: body.cardNumber,
      expiry: body.expiry,
      cvv: body.cvv,
      cardholderName: body.cardholderName,
      email: user?.email as string,
      redirectUrl,
    });

    const row = await createLedgerEntry({
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

    watchPaymentLedger(row);

    if (init.card3ds?.requires3ds && init.card3ds.authUrl) {
      res.status(201).json({
        payment: mapLedgerPublic(row),
        requires3ds: true,
        redirectUrl: init.card3ds.authUrl,
        message: "Complete 3D Secure authentication to finish payment.",
      });
      return;
    }

    res.status(201).json({
      payment: mapLedgerPublic(row),
      message: "Card charge initiated — confirming payment…",
    });
  }),
);

paymentsRouter.post(
  "/manual/initiate",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        applicationId: z.string().uuid(),
        displayCurrency: displayCurrencyField,
      })
      .parse(req.body);

    const row = await initiateManualApplicationPayment(
      req.user!.id,
      body.applicationId,
      body.displayCurrency,
    );

    res.status(201).json({
      payment: mapLedgerPublic(row),
      message: "Transfer the exact amount to one of the accounts shown, using the reference provided.",
    });
  }),
);

const proofSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  fileBase64: z.string().min(1),
});

paymentsRouter.post(
  "/manual/:id/proof",
  asyncHandler(async (req: AuthedRequest, res) => {
    const ledgerId = z.string().uuid().parse(req.params.id);
    const body = proofSchema.parse(req.body);
    const buffer = Buffer.from(body.fileBase64, "base64");

    const row = await submitManualPaymentProof(
      req.user!.id,
      ledgerId,
      body.fileName,
      body.mimeType,
      buffer,
    );

    res.status(201).json({
      payment: mapLedgerPublic(row),
      message: "Proof submitted. Our team will review it shortly.",
    });
  }),
);

paymentsRouter.post(
  "/travel-credit",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = z
      .object({
        applicationId: z.string().uuid(),
        displayCurrency: z.string().length(3).default("MWK"),
      })
      .parse(req.body);

    const result = await payApplicationWithTravelCredit(
      req.user!.id,
      body.applicationId,
      body.displayCurrency,
    );

    res.status(201).json(result);
  }),
);

paymentsRouter.post(
  "/initiate",
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = initiateSchema.parse(req.body);
    const userId = req.user!.id;

    if (!config.usePaymentGateway) {
      throw new AppError(
        400,
        "Online payment is disabled. Pay by bank transfer using the instructions on your quote.",
      );
    }

    const existing = await getActiveLedgerForOrder("flight_application", body.applicationId, userId);
    if (existing) {
      const mapped = mapLedgerPublic(existing);
      res.json({
        payment: mapped,
        checkoutUrl: mapped.checkoutUrl ?? undefined,
        resumed: true,
      });
      if (existing.payment_method !== "hosted_checkout" || hostedCheckoutReadyForVerify(existing)) {
        watchPaymentLedger(existing);
      }
      return;
    }

    const snapshot = await buildApplicationOrderSnapshot(body.applicationId, userId);
    const amountMwk = Number(snapshot.amountMwk);
    if (amountMwk <= 0) throw new AppError(400, "Invalid payment amount");

    const { displayCurrency, paymentCurrency, paymentAmount } = await resolvePaymentAmounts(
      body.applicationId,
      userId,
      amountMwk,
      body.displayCurrency,
    );
    const enrichedSnapshot = {
      ...snapshot,
      displayCurrency,
      paymentCurrency,
      paymentAmount,
    };

    const checkoutMode = config.paychangu.checkoutMode;
    if (body.method === "hosted_checkout" && checkoutMode !== "hosted") {
      throw new AppError(400, "Hosted checkout is not enabled");
    }
    if (body.method !== "hosted_checkout" && checkoutMode === "hosted") {
      throw new AppError(400, "Direct charge is not enabled — use hosted checkout");
    }

    const [users] = await pool.execute<RowDataPacket[]>(
      `SELECT first_name, last_name, email FROM users WHERE id = :id`,
      { id: userId },
    );
    const user = users[0];
    const chargeId = generateChargeId();
    const clientOrigin = config.clientOrigins[0] ?? "http://localhost:3000";

    if (body.method === "hosted_checkout") {
      // callback_url = PayChangu redirect after successful payment (appends tx_ref + status)
      // return_url = PayChangu redirect after cancel / failed attempts (appends tx_ref + status=failed)
      const callbackUrl = `${clientOrigin}/dashboard/applications?applicationId=${body.applicationId}&hosted=callback`;
      const returnUrl = `${clientOrigin}/dashboard/applications?applicationId=${body.applicationId}&hosted=cancel`;

      const init = await paychangu.initHostedCheckout({
        txRef: chargeId,
        amount: paymentAmount,
        currency: paymentCurrency,
        email: user?.email as string | undefined,
        firstName: user?.first_name as string | undefined,
        lastName: user?.last_name as string | undefined,
        callbackUrl,
        returnUrl,
        title: `Biazo · ${snapshot.referenceNumber}`,
        description: `${snapshot.originCity} → ${snapshot.destinationCity}`,
        meta: { applicationId: body.applicationId, clientReference: chargeId },
      });

      const row = await createLedgerEntry({
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
        payment: mapLedgerPublic(row),
        checkoutUrl: init.checkoutUrl,
        message: "Redirecting to PayChangu secure checkout…",
      });
      return;
    }

    if (body.method === "mobile_money") {
      const operators = await paychangu.getMobileMoneyOperators();
      const operator = operators.find((o) => o.ref_id === body.operatorRefId);

      const init = await paychangu.initMobileMoney({
        chargeId,
        amount: paymentAmount,
        currency: paymentCurrency,
        mobile: body.mobile,
        operatorRefId: body.operatorRefId,
        email: user?.email as string | undefined,
        firstName: user?.first_name as string | undefined,
        lastName: user?.last_name as string | undefined,
      });

      const row = await createLedgerEntry({
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

      watchPaymentLedger(row);
      res.status(201).json({
        payment: mapLedgerPublic(row),
        message: "PIN prompt sent — approve the payment on your phone.",
      });
      return;
    }

    if (body.method === "bank") {
      const init = await paychangu.initBankTransfer({
        chargeId,
        amount: paymentAmount,
        currency: paymentCurrency,
      });

      const row = await createLedgerEntry({
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

      watchPaymentLedger(row);
      res.status(201).json({
        payment: mapLedgerPublic(row),
        message: "Transfer to the account details shown. We will confirm automatically.",
      });
      return;
    }

    const redirectUrl =
      body.redirectUrl ??
      `${clientOrigin}/dashboard/applications?applicationId=${body.applicationId}`;

    const init = await paychangu.initCardCharge({
      chargeId,
      amount: paymentAmount,
      currency: paymentCurrency,
      cardNumber: body.cardNumber,
      expiry: body.expiry,
      cvv: body.cvv,
      cardholderName: body.cardholderName,
      email: user?.email as string,
      redirectUrl,
    });

    const row = await createLedgerEntry({
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

    watchPaymentLedger(row);

    if (init.card3ds?.requires3ds && init.card3ds.authUrl) {
      res.status(201).json({
        payment: mapLedgerPublic(row),
        requires3ds: true,
        redirectUrl: init.card3ds.authUrl,
        message: "Complete 3D Secure authentication to finish payment.",
      });
      return;
    }

    res.status(201).json({
      payment: mapLedgerPublic(row),
      message: "Card charge initiated — confirming payment…",
    });
  }),
);

paymentsRouter.post(
  "/:id/verify",
  asyncHandler(async (req: AuthedRequest, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const row = await getLedgerById(id, req.user!.id);
    if (!row) throw new AppError(404, "Payment not found");

    const outcome = await verifyAndProcessLedger(row);
    const updated = await getLedgerById(id, req.user!.id);
    res.json({ payment: mapLedgerPublic(updated!), outcome });
  }),
);
