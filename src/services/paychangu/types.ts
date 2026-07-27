export type PayChanguMethod = "mobile_money" | "bank" | "card" | "hosted_checkout";

export type MomoOperator = {
  ref_id: string;
  name: string;
  country?: string;
};

export type PayChanguInitResult = {
  chargeId: string;
  refId?: string;
  status: string;
  raw: unknown;
  checkoutUrl?: string;
  bankDetails?: {
    bankName: string;
    accountNumber: string;
    accountName: string;
    expiresAt: Date | null;
  };
  card3ds?: {
    requires3ds: boolean;
    authUrl: string | null;
    orderReference?: string;
  };
};

export type PayChanguVerifyResult = {
  success: boolean;
  status: string;
  refId?: string;
  raw: unknown;
};
