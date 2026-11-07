import { config } from "../config.js";

export function buildAgentReferralLink(code: string) {
  return `${config.publicAppUrl}/?agent=${encodeURIComponent(code)}`;
}
