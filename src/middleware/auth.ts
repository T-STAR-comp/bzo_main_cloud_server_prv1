import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "../utils/jwt.js";
import { verifyAccessToken } from "../utils/jwt.js";

export type AuthedRequest = Request & {
  user?: { id: string; email: string; role: UserRole };
};

export function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    if (payload.type !== "access") {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role ?? "user",
    };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
