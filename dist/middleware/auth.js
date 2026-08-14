"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.requireAdmin = requireAdmin;
const jwt_js_1 = require("../utils/jwt.js");
function authenticate(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }
    try {
        const payload = (0, jwt_js_1.verifyAccessToken)(token);
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
    }
    catch {
        res.status(401).json({ error: "Invalid or expired token" });
    }
}
function requireAdmin(req, res, next) {
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
