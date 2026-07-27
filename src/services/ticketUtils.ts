/** Ticket is inactive 10 minutes after scheduled departure. */
export function isTicketInactive(departAt: string | Date): boolean {
  const depart = new Date(departAt);
  const cutoff = depart.getTime() + 10 * 60 * 1000;
  return Date.now() >= cutoff;
}

export function ticketDisplayStatus(
  departAt: string | Date,
  dbStatus: string,
): "active" | "inactive" | "cancelled" {
  if (dbStatus === "cancelled") return "cancelled";
  if (dbStatus === "completed" || isTicketInactive(departAt)) return "inactive";
  return "active";
}
