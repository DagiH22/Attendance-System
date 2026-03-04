import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const prisma = new PrismaClient();

/**
 * POST /login
 * Body: { email: string, password: string }
 * Response: { token: string, admin: { ...adminWithoutPassword } }
 */
export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Email and password are required." });
    }

    const admin = await prisma.admin.findUnique({ where: { email } });

    if (!admin) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const passwordMatches = await bcrypt.compare(password, admin.password);
    if (!passwordMatches) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("JWT_SECRET is not defined in environment.");
      return res
        .status(500)
        .json({ error: "Authentication configuration error." });
    }

    const tokenPayload = {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    };

    const token = jwt.sign(tokenPayload, jwtSecret, { expiresIn: "8h" });

    // Exclude password from returned admin object
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pw, ...adminSafe } = admin as any;

    return res.status(200).json({ token, admin: adminSafe });
  } catch (err) {
    console.error("Error in login:", err);
    return res.status(500).json({ error: "Internal server error." });
  }
};

export default { login };
