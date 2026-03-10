import { Router } from "express";
import {
  createMember,
  getAllMembers,
  getMemberById,
  searchMembers,
  deactivateMember,
  resendMemberQr,
  activateMember,
} from "../controllers/member.controller";
import requireRole from "../middleware/role.middleware";
import verifyAuth from "../middleware/auth.middleware";

const router = Router();

// All member routes require authentication
router.use(verifyAuth);

// create member
router.post("/", createMember);

// get all members
router.get("/", getAllMembers);

// search and get by name or uniqueId (case-insensitive)
router.get("/search", searchMembers);

// get by id
router.get("/:id", getMemberById);

// deactivate member (super admin only)
router.patch("/:id/deactivate", requireRole("SUPER_ADMIN"), deactivateMember);

// resend QR email
router.post("/:id/resend-qr", resendMemberQr);

// activate member (super admin only)
router.patch("/:id/activate", requireRole("SUPER_ADMIN"), activateMember);

export default router;
