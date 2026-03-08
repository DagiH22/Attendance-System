import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { verifyAccessToken } from "../utils/token.utils";

export const verifyAuth = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const authHeader =
      req.header("Authorization") ?? req.header("authorization");
    if (!authHeader) {
      return res.status(401).json({ error: "Authorization header missing" });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      return res.status(401).json({ error: "Malformed Authorization header" });
    }

    const token = parts[1];
    let decoded: any;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      const isExpired = err instanceof jwt.TokenExpiredError;
      console.warn("Access token verification failed:", err);
      return res.status(401).json({
        error: isExpired
          ? "Session expired. Please sign in again."
          : "Unauthorized",
        code: isExpired ? "ACCESS_TOKEN_EXPIRED" : "UNAUTHORIZED",
      });
    }

    // attach admin payload to request
    // Expected payload shape: { id, email, role }
    req.admin = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };

    return next();
  } catch (err) {
    console.error("Error in verifyAuth middleware:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default verifyAuth;
