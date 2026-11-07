"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAgentReferralLink = buildAgentReferralLink;
const config_js_1 = require("../config.js");
function buildAgentReferralLink(code) {
    return `${config_js_1.config.publicAppUrl}/?agent=${encodeURIComponent(code)}`;
}
