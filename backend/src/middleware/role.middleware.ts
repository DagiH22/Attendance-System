import { Request, Response, NextFunction } from "express";

export const requireRole = (role: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.admin?.id) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (req.admin.role !== role) {
        return res.status(403).json({ error: "Forbidden" });
      }

      return next();
    } catch (err) {
      console.error("Error in requireRole middleware:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  };
};

export default requireRole;
