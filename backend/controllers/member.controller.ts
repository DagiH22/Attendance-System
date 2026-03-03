import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

// Generate an alphanumeric id of length between min and max (inclusive)
const generateRandomId = (min = 10, max = 12) => {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const length = Math.floor(Math.random() * (max - min + 1)) + min;
  // Use crypto for secure randomness
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    const idx = bytes[i] % chars.length;
    out += chars[idx];
  }
  return out;
};

// Try to produce a unique uniqueId by checking the DB; limit attempts to avoid infinite loops
const makeUniqueUniqueId = async (attempts = 10) => {
  for (let i = 0; i < attempts; i++) {
    const candidate = generateRandomId();
    const existing = await prisma.member.findUnique({
      where: { uniqueId: candidate },
    });
    if (!existing) return candidate;
  }
  throw new Error("Unable to generate unique uniqueId after multiple attempts");
};

export const createMember = async (req: Request, res: Response) => {
  try {
    const { name, email, phone, isActive } = req.body ?? {};

    if (!name || !email) {
      return res.status(400).json({ error: "name and email are required" });
    }

    // Optionally ensure email uniqueness
    const existingByEmail = await prisma.member.findUnique({
      where: { email },
    });
    if (existingByEmail) {
      return res
        .status(409)
        .json({ error: "A member with that email already exists" });
    }

    const uniqueId = await makeUniqueUniqueId();

    const created = await prisma.member.create({
      data: {
        uniqueId,
        name,
        email,
        phone: phone ?? null,
        isActive: typeof isActive === "boolean" ? isActive : true,
      },
    });

    // Member model doesn't contain sensitive fields by design; return created record
    return res.status(201).json({ member: created });
  } catch (err: any) {
    console.error("Error in createMember:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getAllMembers = async (_req: Request, res: Response) => {
  try {
    const members = await prisma.member.findMany();
    return res.status(200).json({ members });
  } catch (err: any) {
    console.error("Error in getAllMembers:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getMemberById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const idStr = Array.isArray(id) ? id[0] : id;
    if (!idStr) return res.status(400).json({ error: "Member id is required" });

    const member = await prisma.member.findUnique({ where: { id: idStr } });
    if (!member) return res.status(404).json({ error: "Member not found" });

    return res.status(200).json({ member });
  } catch (err: any) {
    console.error("Error in getMemberById:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const searchMembers = async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) ?? "";
    if (!q)
      return res.status(400).json({ error: "query param 'q' is required" });

    const members = await prisma.member.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { uniqueId: { contains: q, mode: "insensitive" } },
        ],
      },
    });

    return res.status(200).json({ members });
  } catch (err: any) {
    console.error("Error in searchMembers:", err?.message ?? err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export default { createMember, getAllMembers, getMemberById, searchMembers };
