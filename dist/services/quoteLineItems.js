"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseQuoteLineItems = parseQuoteLineItems;
exports.activeQuoteLineItems = activeQuoteLineItems;
exports.quoteTotals = quoteTotals;
exports.buildQuoteLineItemsFromAdmin = buildQuoteLineItemsFromAdmin;
exports.removeQuoteLineItem = removeQuoteLineItem;
exports.quoteLineItemsSummary = quoteLineItemsSummary;
const uuid_1 = require("uuid");
function parseQuoteLineItems(raw) {
    if (!raw)
        return [];
    if (typeof raw === "string") {
        try {
            return parseQuoteLineItems(JSON.parse(raw));
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(raw))
        return [];
    return raw
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
        id: String(item.id ?? (0, uuid_1.v4)()),
        type: item.type ?? "extra",
        label: String(item.label ?? "Charge"),
        description: String(item.description ?? ""),
        amountMwk: Number(item.amountMwk ?? 0),
        removable: Boolean(item.removable),
        removed: Boolean(item.removed),
        details: item.details && typeof item.details === "object" ? item.details : undefined,
    }));
}
function activeQuoteLineItems(items) {
    return items.filter((item) => !item.removed);
}
function quoteTotals(items) {
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
function buildQuoteLineItemsFromAdmin(input) {
    const items = [
        {
            id: (0, uuid_1.v4)(),
            type: "fare",
            label: "Flight fare",
            description: "Main airfare for quoted itinerary",
            amountMwk: input.quotedPriceMwk,
            removable: false,
        },
    ];
    if (input.hotel && input.hotel.amountMwk > 0) {
        const details = { hotelName: input.hotel.hotelName };
        if (input.hotel.nights)
            details.nights = input.hotel.nights;
        if (input.hotel.roomType)
            details.roomType = input.hotel.roomType;
        items.push({
            id: (0, uuid_1.v4)(),
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
        const details = {
            provider: input.carRental.provider,
            vehicle: input.carRental.vehicle,
        };
        if (input.carRental.days)
            details.days = input.carRental.days;
        items.push({
            id: (0, uuid_1.v4)(),
            type: "car_rental",
            label: `Car rental · ${input.carRental.provider}`,
            description: `${input.carRental.vehicle}${input.carRental.days ? ` · ${input.carRental.days} day(s)` : ""}`,
            amountMwk: input.carRental.amountMwk,
            removable: true,
            details,
        });
    }
    for (const extra of input.extras ?? []) {
        if (extra.amountMwk <= 0)
            continue;
        items.push({
            id: (0, uuid_1.v4)(),
            type: "extra",
            label: extra.label,
            description: extra.description,
            amountMwk: extra.amountMwk,
            removable: true,
        });
    }
    return items;
}
function removeQuoteLineItem(items, itemId) {
    return items.map((item) => item.id === itemId && item.removable ? { ...item, removed: true } : item);
}
function quoteLineItemsSummary(items) {
    return activeQuoteLineItems(items)
        .map((item) => `${item.label}: MWK ${item.amountMwk.toLocaleString()}`)
        .join("\n");
}
