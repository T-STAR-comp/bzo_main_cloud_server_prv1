import fs from "fs/promises";
import path from "path";
import type { RowDataPacket } from "mysql2";
import { config } from "../config.js";
import { logger } from "../logger.js";

function resolveStorePath(relativePath: string) {
  const root = path.resolve(process.cwd(), config.dataStorePath);
  const abs = path.resolve(root, relativePath);
  if (!abs.startsWith(root + path.sep) && abs !== root) {
    throw new Error("Invalid storage path");
  }
  return abs;
}

export async function ensureDataStore() {
  const root = path.resolve(process.cwd(), config.dataStorePath);
  await fs.mkdir(path.join(root, "tickets"), { recursive: true });
  await fs.mkdir(path.join(root, "payment-proofs"), { recursive: true });
  logger.info(`Data store ready at ${root}`);
}

export function ticketStoragePath(applicationId: string, ticketId: string, fileName: string) {
  const ext = path.extname(fileName) || ".bin";
  const safeName = `${ticketId}${ext}`;
  return `tickets/${applicationId}/${safeName}`;
}

export async function saveTicketFile(applicationId: string, ticketId: string, fileName: string, buffer: Buffer) {
  const relativePath = ticketStoragePath(applicationId, ticketId, fileName);
  const abs = resolveStorePath(relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return relativePath;
}

export async function readStoredFile(relativePath: string): Promise<Buffer> {
  return fs.readFile(resolveStorePath(relativePath));
}

export function paymentProofStoragePath(ledgerId: string, fileName: string) {
  const ext = path.extname(fileName) || ".bin";
  const safeName = `${ledgerId}${ext}`;
  return `payment-proofs/${safeName}`;
}

export async function savePaymentProofFile(ledgerId: string, fileName: string, buffer: Buffer) {
  const relativePath = paymentProofStoragePath(ledgerId, fileName);
  const abs = resolveStorePath(relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buffer);
  return relativePath;
}

export async function loadTicketFileContent(row: {
  file_path?: string | null;
  file_data?: Buffer | null;
} | RowDataPacket): Promise<Buffer> {
  const r = row as { file_path?: string | null; file_data?: Buffer | null };
  if (r.file_path) {
    return readStoredFile(r.file_path);
  }
  if (r.file_data) {
    return Buffer.isBuffer(r.file_data) ? r.file_data : Buffer.from(r.file_data);
  }
  throw new Error("Ticket file not found");
}
