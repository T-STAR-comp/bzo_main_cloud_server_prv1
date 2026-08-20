import { Router } from "express";
import type { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler.js";
import { getPlatformSettings } from "../services/platformSettings.js";

export const publicRouter = Router();

publicRouter.get(
  "/support",
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = await getPlatformSettings();
    const wa = settings.whatsappNumber.replace(/\D/g, "");
    res.json({
      whatsappNumber: settings.whatsappNumber,
      whatsappUrl: `https://wa.me/${wa}`,
      conciergePhone: settings.conciergePhone,
    });
  }),
);
