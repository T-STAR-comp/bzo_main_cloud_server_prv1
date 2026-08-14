"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTicketInactive = isTicketInactive;
exports.ticketDisplayStatus = ticketDisplayStatus;
/** Ticket is inactive 10 minutes after scheduled departure. */
function isTicketInactive(departAt) {
    const depart = new Date(departAt);
    const cutoff = depart.getTime() + 10 * 60 * 1000;
    return Date.now() >= cutoff;
}
function ticketDisplayStatus(departAt, dbStatus) {
    if (dbStatus === "cancelled")
        return "cancelled";
    if (dbStatus === "completed" || isTicketInactive(departAt))
        return "inactive";
    return "active";
}
