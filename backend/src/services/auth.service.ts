import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import {
  createAccessToken,
  createRefreshToken,
  type AuthTokenPayload,
} from "../utils/token.utils";

const prisma = new PrismaClient();

export type AuthAdmin = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
};

export const sanitizeAdmin = (admin: {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: admin.id,
  name: admin.name,
  email: admin.email,
  role: admin.role,
  createdAt: admin.createdAt,
  updatedAt: admin.updatedAt,
});

export const validateAdminCredentials = async (
  email: string,
  password: string,
) => {
  const admin = await prisma.admin.findUnique({ where: { email } });

  if (!admin) {
    return null;
  }

  const passwordMatches = await bcrypt.compare(password, admin.password);
  if (!passwordMatches) {
    return null;
  }

  return admin;
};

export const buildAuthPayload = (admin: {
  id: string;
  email: string;
  role: string;
  sessionId?: string;
}): AuthTokenPayload => ({
  id: admin.id,
  email: admin.email,
  role: admin.role,
  sessionId: admin.sessionId,
});

export const issueSessionTokens = (payload: AuthTokenPayload) => ({
  accessToken: createAccessToken(payload),
  refreshToken: createRefreshToken(payload),
});

export const findAdminById = async (id: string) => {
  const admin = await prisma.admin.findUnique({
    where: { id },
  });

  return admin ? sanitizeAdmin(admin as AuthAdmin) : null;
};

export default {
  sanitizeAdmin,
  validateAdminCredentials,
  buildAuthPayload,
  issueSessionTokens,
  findAdminById,
};
