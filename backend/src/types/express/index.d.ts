import { Role } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      admin?: {
        id: string;
        email: string;
        role: Role;
      };
    }
  }
}

export {};