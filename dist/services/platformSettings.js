"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlatformSettings = getPlatformSettings;
exports.updatePlatformSettings = updatePlatformSettings;
exports.getEmailFooterLine = getEmailFooterLine;
const pool_js_1 = require("../db/pool.js");
const config_js_1 = require("../config.js");
const DEFAULTS = {
    whatsappNumber: "+265999000000",
    conciergePhone: "+265 999 000 000",
    reportEmail: config_js_1.config.admin.email,
    reportSchedules: {
        weekly: true,
        monthly: true,
        quarterly: true,
        biannual: true,
        yearly: true,
    },
};
async function getSetting(key) {
    const [rows] = await pool_js_1.pool.execute(`SELECT setting_value FROM platform_settings WHERE setting_key = :key`, { key });
    return rows[0]?.setting_value != null ? String(rows[0].setting_value) : null;
}
async function setSetting(key, value, updatedBy) {
    await pool_js_1.pool.execute(`INSERT INTO platform_settings (setting_key, setting_value, updated_by)
     VALUES (:key, :value, :updatedBy)
     ON DUPLICATE KEY UPDATE setting_value = :value, updated_by = :updatedBy, updated_at = UTC_TIMESTAMP()`, { key, value, updatedBy: updatedBy ?? null });
}
async function getPlatformSettings() {
    const [whatsapp, phone, email, schedules] = await Promise.all([
        getSetting("whatsapp_number"),
        getSetting("concierge_phone"),
        getSetting("report_email"),
        getSetting("report_schedules"),
    ]);
    let reportSchedules = DEFAULTS.reportSchedules;
    if (schedules) {
        try {
            reportSchedules = { ...DEFAULTS.reportSchedules, ...JSON.parse(schedules) };
        }
        catch {
            /* keep defaults */
        }
    }
    return {
        whatsappNumber: whatsapp ?? DEFAULTS.whatsappNumber,
        conciergePhone: phone ?? DEFAULTS.conciergePhone,
        reportEmail: email ?? DEFAULTS.reportEmail,
        reportSchedules,
    };
}
async function updatePlatformSettings(patch, updatedBy) {
    if (patch.whatsappNumber !== undefined) {
        await setSetting("whatsapp_number", patch.whatsappNumber.replace(/\s/g, ""), updatedBy);
    }
    if (patch.conciergePhone !== undefined) {
        await setSetting("concierge_phone", patch.conciergePhone, updatedBy);
    }
    if (patch.reportEmail !== undefined) {
        await setSetting("report_email", patch.reportEmail, updatedBy);
    }
    if (patch.reportSchedules !== undefined) {
        await setSetting("report_schedules", JSON.stringify(patch.reportSchedules), updatedBy);
    }
    return getPlatformSettings();
}
async function getEmailFooterLine() {
    const settings = await getPlatformSettings();
    const wa = settings.whatsappNumber.replace(/\D/g, "");
    return `\n\n- Biazo Travel Agency, Lilongwe, Malawi\nConcierge: ${settings.conciergePhone} · WhatsApp: https://wa.me/${wa}`;
}
