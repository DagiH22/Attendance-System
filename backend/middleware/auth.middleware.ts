import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

// Async wrapper around jwt.verify so we can use async/await
const verifyTokenAsync = (token: string, secret: string) =>
  new Promise<any>((resolve, reject) => {
    jwt.verify(token, secret, (err, decoded) => {
      if (err) return reject(err);
      return resolve(decoded);
    });
  });

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
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("JWT_SECRET is not configured");
      return res
        .status(500)
        .json({ error: "Authentication configuration error" });
    }

    let decoded: any;
    try {
      decoded = await verifyTokenAsync(token, jwtSecret);
    } catch (err) {
      console.warn("Invalid JWT:", err);
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Attach admin payload to request
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
