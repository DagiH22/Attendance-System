import type { Request, Response } from "express";
import {
  clearRefreshTokenCookie,
  refreshCookieName,
  setRefreshTokenCookie,
  verifyRefreshToken,
} from "../utils/token.utils";
import {
  buildAuthPayload,
  findAdminById,
  issueSessionTokens,
  sanitizeAdmin,
  validateAdminCredentials,
} from "../services/auth.service";
import {
  createRefreshSession,
  revokeAllAdminSessions,
  revokeRefreshSession,
  rotateRefreshSession,
  validateStoredRefreshSession,
} from "../services/refresh-session.service";

const getRequestMeta = (req: Request) => ({
  userAgent: req.get("user-agent") ?? null,
  ipAddress: req.ip ?? null,
});

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    }

    const admin = await validateAdminCredentials(email, password);

    if (!admin) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const initialPayload = buildAuthPayload({
      id: admin.id,
      email: admin.email,
      role: admin.role,
    });

    const initialTokens = issueSessionTokens(initialPayload);
    const session = await createRefreshSession({
      adminId: admin.id,
      refreshToken: initialTokens.refreshToken,
      ...getRequestMeta(req),
    });

    const payload = buildAuthPayload({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      sessionId: session.id,
    });

    const { accessToken, refreshToken } = issueSessionTokens(payload);
    await rotateRefreshSession({
      sessionId: session.id,
      refreshToken,
      ...getRequestMeta(req),
    });
    setRefreshTokenCookie(res, refreshToken);

    return res.status(200).json({
      accessToken,
      admin: sanitizeAdmin(admin),
    });
  } catch (err) {
    console.error("Error in login:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const refresh = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.[refreshCookieName];

    if (!refreshToken) {
      clearRefreshTokenCookie(res);
      return res
        .status(401)
        .json({ error: "Session expired. Please sign in again." });
    }

    const decoded = verifyRefreshToken(refreshToken);
    const sessionCheck = await validateStoredRefreshSession({
      payload: decoded,
      refreshToken,
    });

    if (sessionCheck.status === "reuse-detected") {
      await revokeAllAdminSessions(decoded.id);
      clearRefreshTokenCookie(res);
      return res
        .status(401)
        .json({ error: "Session expired. Please sign in again." });
    }

    if (sessionCheck.status !== "valid" || !sessionCheck.session) {
      clearRefreshTokenCookie(res);
      return res
        .status(401)
        .json({ error: "Session expired. Please sign in again." });
    }

    const admin = await findAdminById(decoded.id);

    if (!admin) {
      await revokeAllAdminSessions(decoded.id);
      clearRefreshTokenCookie(res);
      return res
        .status(401)
        .json({ error: "Session expired. Please sign in again." });
    }

    const payload = buildAuthPayload({
      id: admin.id,
      email: admin.email,
      role: admin.role,
      sessionId: sessionCheck.session.id,
    });

    const tokens = issueSessionTokens(payload);
    await rotateRefreshSession({
      sessionId: sessionCheck.session.id,
      refreshToken: tokens.refreshToken,
      ...getRequestMeta(req),
    });
    setRefreshTokenCookie(res, tokens.refreshToken);

    return res.status(200).json({
      accessToken: tokens.accessToken,
      admin,
    });
  } catch (err) {
    clearRefreshTokenCookie(res);
    console.warn("Refresh token verification failed:", err);
    return res
      .status(401)
      .json({ error: "Session expired. Please sign in again." });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.[refreshCookieName];

    if (refreshToken) {
      try {
        const decoded = verifyRefreshToken(refreshToken);
        if (decoded.sessionId) {
          await revokeRefreshSession(decoded.sessionId);
        }
      } catch {
        // ignore invalid refresh token on logout and still clear the cookie
      }
    }

    clearRefreshTokenCookie(res);
    return res.status(200).json({ message: "Logged out successfully." });
  } catch (err) {
    console.error("Error in logout:", err);
    clearRefreshTokenCookie(res);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export const me = async (req: Request, res: Response) => {
  try {
    if (!req.admin?.id) {
      return res
        .status(401)
        .json({ error: "Session expired. Please sign in again." });
    }

    const admin = await findAdminById(req.admin.id);
    if (!admin) {
      return res
        .status(401)
        .json({ error: "Session expired. Please sign in again." });
    }

    return res.status(200).json({ admin });
  } catch (err) {
    console.error("Error in me:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export default { login, refresh, logout, me };
