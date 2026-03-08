import jwt from "jsonwebtoken";
import type { Response } from "express";
import crypto from "crypto";

export type AuthTokenPayload = {
  id: string;
  email: string;
  role: string;
  sessionId?: string;
};

const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_TOKEN_EXPIRES_IN = "7d";
const REFRESH_COOKIE_NAME = "refreshToken";

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not configured");
  }

  return secret;
};

const getRefreshSecret = () => {
  return process.env.JWT_REFRESH_SECRET || getJwtSecret();
};

export const createAccessToken = (payload: AuthTokenPayload) =>
  jwt.sign(payload, getJwtSecret(), {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });

export const createRefreshToken = (payload: AuthTokenPayload) =>
  jwt.sign(payload, getRefreshSecret(), {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
  });

export const verifyAccessToken = (token: string) =>
  jwt.verify(token, getJwtSecret()) as AuthTokenPayload;

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, getRefreshSecret()) as AuthTokenPayload;

export const hashRefreshToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const getRefreshTokenExpiryDate = () => {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt;
};

export const setRefreshTokenCookie = (res: Response, refreshToken: string) => {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/auth",
  });
};

export const clearRefreshTokenCookie = (res: Response) => {
  const isProduction = process.env.NODE_ENV === "production";

  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/auth",
  });
};

export const refreshCookieName = REFRESH_COOKIE_NAME;
