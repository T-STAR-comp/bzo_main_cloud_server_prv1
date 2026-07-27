import type { RowDataPacket } from "mysql2";

export function requiredTicketCount(input: {
  passengerCount: number;
  tripType: string;
}): number {
  const segments = input.tripType === "roundtrip" ? 2 : 1;
  return Math.max(1, input.passengerCount * segments);
}

export function ticketSlotLabel(input: {
  index: number;
  passengerCount: number;
  tripType: string;
  passengers?: Array<{ firstName: string; lastName: string }>;
}): string {
  const segments = input.tripType === "roundtrip" ? 2 : 1;
  const total = requiredTicketCount({
    passengerCount: input.passengerCount,
    tripType: input.tripType,
  });

  if (segments > 1 && input.passengerCount === 1) {
    return input.index === 0 ? "Outbound flight" : "Return flight";
  }

  if (input.passengerCount > 1 && segments === 1) {
    const pax = input.passengers?.[input.index];
    return pax ? `${pax.firstName} ${pax.lastName}` : `Passenger ${input.index + 1}`;
  }

  if (segments > 1 && input.passengerCount > 1) {
    const paxIndex = input.index % input.passengerCount;
    const leg = Math.floor(input.index / input.passengerCount) === 0 ? "Outbound" : "Return";
    const pax = input.passengers?.[paxIndex];
    const name = pax ? `${pax.firstName} ${pax.lastName}` : `Passenger ${paxIndex + 1}`;
    return `${leg} · ${name}`;
  }

  return `Ticket ${input.index + 1} of ${total}`;
}

export function defaultPassengerForTicketIndex(input: {
  index: number;
  passengerCount: number;
  tripType: string;
  passengers: Array<{ firstName: string; lastName: string }>;
}): string {
  if (input.passengers.length === 0) return "";
  const segments = input.tripType === "roundtrip" ? 2 : 1;
  const paxIndex =
    segments > 1 && input.passengerCount === 1
      ? 0
      : input.index % input.passengers.length;
  const pax = input.passengers[paxIndex];
  return pax ? `${pax.firstName} ${pax.lastName}` : "";
}

export function mapApplicationTicketRow(row: RowDataPacket) {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    segmentOrder: Number(row.segment_order ?? 1),
    ticketRecordId: row.ticket_record_id ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    bookingNumber: row.pnr ?? row.booking_number ?? null,
    seat: row.seat ?? null,
    airline: row.airline ?? null,
    flightNumber: row.flight_label ?? row.flight_number ?? null,
    gate: row.gate ?? null,
    departAt: row.depart_at ? new Date(row.depart_at as string).toISOString() : null,
    arriveAt: row.arrive_at ? new Date(row.arrive_at as string).toISOString() : null,
    passengerNames: row.passenger_names ?? null,
    cabinClass: row.class ?? null,
  };
}
