import { PrismaClient } from "@prisma/client";
import {
  getRefreshTokenExpiryDate,
  hashRefreshToken,
  type AuthTokenPayload,
} from "../utils/token.utils";

const prisma = new PrismaClient();

export const createRefreshSession = async (input: {
  adminId: string;
  refreshToken: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}) => {
  const expiresAt = getRefreshTokenExpiryDate();

  return prisma.refreshSession.create({
    data: {
      adminId: input.adminId,
      tokenHash: hashRefreshToken(input.refreshToken),
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      expiresAt,
    },
  });
};

export const findSessionById = async (sessionId: string) => {
  return prisma.refreshSession.findUnique({
    where: { id: sessionId },
  });
};

export const isSessionActive = (session: {
  revokedAt: Date | null;
  expiresAt: Date;
}) => {
  return !session.revokedAt && session.expiresAt.getTime() > Date.now();
};

export const rotateRefreshSession = async (input: {
  sessionId: string;
  refreshToken: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}) => {
  const expiresAt = getRefreshTokenExpiryDate();

  return prisma.refreshSession.update({
    where: { id: input.sessionId },
    data: {
      tokenHash: hashRefreshToken(input.refreshToken),
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      expiresAt,
      revokedAt: null,
    },
  });
};

export const revokeRefreshSession = async (sessionId: string) => {
  return prisma.refreshSession.updateMany({
    where: {
      id: sessionId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
};

export const revokeAllAdminSessions = async (adminId: string) => {
  return prisma.refreshSession.updateMany({
    where: {
      adminId,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
};

export const validateStoredRefreshSession = async (input: {
  payload: AuthTokenPayload;
  refreshToken: string;
}) => {
  if (!input.payload.sessionId) {
    return { status: "missing-session" as const, session: null };
  }

  const session = await findSessionById(input.payload.sessionId);
  if (!session) {
    return { status: "missing-session" as const, session: null };
  }

  const incomingHash = hashRefreshToken(input.refreshToken);
  if (session.tokenHash !== incomingHash) {
    return { status: "reuse-detected" as const, session };
  }

  if (session.adminId !== input.payload.id) {
    return { status: "reuse-detected" as const, session };
  }

  if (!isSessionActive(session)) {
    return { status: "expired" as const, session };
  }

  return { status: "valid" as const, session };
};

export default {
  createRefreshSession,
  findSessionById,
  isSessionActive,
  rotateRefreshSession,
  revokeRefreshSession,
  revokeAllAdminSessions,
  validateStoredRefreshSession,
};
