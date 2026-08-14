import type { RowDataPacket } from "mysql2";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import { periodForReportType, sendFinancialReport } from "./financialReports.js";
import { getPlatformSettings, type ReportSchedules } from "./platformSettings.js";

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function lastReportSent(type: string) {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT period_end FROM report_schedule_log WHERE report_type = :type ORDER BY created_at DESC LIMIT 1`,
    { type },
  );
  return rows[0]?.period_end ? new Date(rows[0].period_end as string) : null;
}

function isDue(lastEnd: Date | null, minDays: number) {
  if (!lastEnd) return true;
  const daysSince = (Date.now() - lastEnd.getTime()) / (24 * 60 * 60 * 1000);
  return daysSince >= minDays;
}

async function maybeSend(type: keyof ReportSchedules, minDays: number) {
  const settings = await getPlatformSettings();
  if (!settings.reportSchedules[type]) return;

  const last = await lastReportSent(type);
  if (!isDue(last, minDays)) return;

  const period = periodForReportType(type);
  try {
    await sendFinancialReport(period.from, period.to, period.label, type);
    logger.info(`Scheduled ${type} financial report sent`);
  } catch (error) {
    logger.error(`Failed to send ${type} financial report`, error);
  }
}

export async function runScheduledReports() {
  await maybeSend("weekly", 7);
  await maybeSend("monthly", 28);
  await maybeSend("quarterly", 89);
  await maybeSend("biannual", 179);
  await maybeSend("yearly", 364);
}

export function startReportScheduler() {
  const safeRun = () => {
    void runScheduledReports().catch((error) => {
      logger.error("Financial report scheduler run failed", error);
    });
  };
  safeRun();
  setInterval(safeRun, CHECK_INTERVAL_MS);
  logger.info("Financial report scheduler started");
}
