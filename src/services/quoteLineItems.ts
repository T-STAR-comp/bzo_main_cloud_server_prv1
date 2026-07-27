import { v4 as uuid } from "uuid";

export type QuoteLineItemType = "fare" | "hotel" | "car_rental" | "extra";

export type QuoteLineItem = {
  id: string;
  type: QuoteLineItemType;
  label: string;
  description: string;
  amountMwk: number;
  removable: boolean;
  removed?: boolean;
  details?: Record<string, string>;
};

export function parseQuoteLineItems(raw: unknown): QuoteLineItem[] {
  if (!raw) return [];
  if (typeof raw === "string") {
    try {
      return parseQuoteLineItems(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: String(item.id ?? uuid()),
      type: (item.type as QuoteLineItemType) ?? "extra",
      label: String(item.label ?? "Charge"),
      description: String(item.description ?? ""),
      amountMwk: Number(item.amountMwk ?? 0),
      removable: Boolean(item.removable),
      removed: Boolean(item.removed),
      details: item.details && typeof item.details === "object" ? (item.details as Record<string, string>) : undefined,
    }));
}

export function activeQuoteLineItems(items: QuoteLineItem[]) {
  return items.filter((item) => !item.removed);
}

export function quoteTotals(items: QuoteLineItem[]) {
  const active = activeQuoteLineItems(items);
  const fareItem = active.find((i) => i.type === "fare");
  const fareMwk = fareItem?.amountMwk ?? 0;
  const extrasMwk = active.filter((i) => i.type !== "fare").reduce((sum, i) => sum + i.amountMwk, 0);
  return {
    fareMwk,
    extrasMwk,
    totalMwk: fareMwk + extrasMwk,
    activeItems: active,
  };
}

export function buildQuoteLineItemsFromAdmin(input: {
  quotedPriceMwk: number;
  hotel?: { hotelName: string; nights?: string; roomType?: string; amountMwk: number } | null;
  carRental?: { provider: string; vehicle: string; days?: string; amountMwk: number } | null;
  extras?: Array<{ label: string; description: string; amountMwk: number }>;
}): QuoteLineItem[] {
  const items: QuoteLineItem[] = [
    {
      id: uuid(),
      type: "fare",
      label: "Flight fare",
      description: "Main airfare for quoted itinerary",
      amountMwk: input.quotedPriceMwk,
      removable: false,
    },
  ];

  if (input.hotel && input.hotel.amountMwk > 0) {
    const details: Record<string, string> = { hotelName: input.hotel.hotelName };
    if (input.hotel.nights) details.nights = input.hotel.nights;
    if (input.hotel.roomType) details.roomType = input.hotel.roomType;
    items.push({
      id: uuid(),
      type: "hotel",
      label: `Hotel · ${input.hotel.hotelName}`,
      description: [
        input.hotel.roomType,
        input.hotel.nights ? `${input.hotel.nights} night(s)` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      amountMwk: input.hotel.amountMwk,
      removable: true,
      details,
    });
  }

  if (input.carRental && input.carRental.amountMwk > 0) {
    const details: Record<string, string> = {
      provider: input.carRental.provider,
      vehicle: input.carRental.vehicle,
    };
    if (input.carRental.days) details.days = input.carRental.days;
    items.push({
      id: uuid(),
      type: "car_rental",
      label: `Car rental · ${input.carRental.provider}`,
      description: `${input.carRental.vehicle}${input.carRental.days ? ` · ${input.carRental.days} day(s)` : ""}`,
      amountMwk: input.carRental.amountMwk,
      removable: true,
      details,
    });
  }

  for (const extra of input.extras ?? []) {
    if (extra.amountMwk <= 0) continue;
    items.push({
      id: uuid(),
      type: "extra",
      label: extra.label,
      description: extra.description,
      amountMwk: extra.amountMwk,
      removable: true,
    });
  }

  return items;
}

export function removeQuoteLineItem(items: QuoteLineItem[], itemId: string) {
  return items.map((item) =>
    item.id === itemId && item.removable ? { ...item, removed: true } : item,
  );
}

export function quoteLineItemsSummary(items: QuoteLineItem[]) {
  return activeQuoteLineItems(items)
    .map((item) => `${item.label}: MWK ${item.amountMwk.toLocaleString()}`)
    .join("\n");
}
