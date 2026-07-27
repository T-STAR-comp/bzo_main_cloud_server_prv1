import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "../config.js";

export type UserRole = "user" | "admin";

export type AccessPayload = {
  sub: string;
  email: string;
  role: UserRole;
  type: "access";
};

export type RefreshPayload = {
  sub: string;
  sid: string;
  type: "refresh";
};

const accessSignOptions: SignOptions = { expiresIn: config.jwt.accessTtl as SignOptions["expiresIn"] };
const refreshSignOptions: SignOptions = { expiresIn: config.jwt.refreshTtl as SignOptions["expiresIn"] };

export function signAccessToken(userId: string, email: string, role: UserRole = "user") {
  return jwt.sign({ sub: userId, email, role, type: "access" } satisfies AccessPayload, config.jwt.accessSecret, accessSignOptions);
}

export function signRefreshToken(userId: string, sessionId: string) {
  return jwt.sign({ sub: userId, sid: sessionId, type: "refresh" } satisfies RefreshPayload, config.jwt.refreshSecret, refreshSignOptions);
}

export function verifyAccessToken(token: string) {
  return jwt.verify(token, config.jwt.accessSecret) as AccessPayload;
}

export function verifyRefreshToken(token: string) {
  return jwt.verify(token, config.jwt.refreshSecret) as RefreshPayload;
}

export function generateNumericCode(length = 6) {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code;
}
