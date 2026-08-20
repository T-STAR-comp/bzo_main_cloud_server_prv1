"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicRouter = void 0;
const express_1 = require("express");
const errorHandler_js_1 = require("../middleware/errorHandler.js");
const platformSettings_js_1 = require("../services/platformSettings.js");
exports.publicRouter = (0, express_1.Router)();
exports.publicRouter.get("/support", (0, errorHandler_js_1.asyncHandler)(async (_req, res) => {
    const settings = await (0, platformSettings_js_1.getPlatformSettings)();
    const wa = settings.whatsappNumber.replace(/\D/g, "");
    res.json({
        whatsappNumber: settings.whatsappNumber,
        whatsappUrl: `https://wa.me/${wa}`,
        conciergePhone: settings.conciergePhone,
    });
}));
