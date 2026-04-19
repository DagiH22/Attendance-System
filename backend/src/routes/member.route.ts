import { Router } from "express";
import {
  createMember,
  exportMembersExcel,
  getAllMembers,
  getMembersCount,
  getMemberAttendanceDetails,
  getMemberById,
  searchMembers,
  updateMember,
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

// get total member count (lightweight)
router.get("/count", getMembersCount);

// search and get by name or uniqueId (case-insensitive)
router.get("/search", searchMembers);

// export members list as Excel
router.get("/export/excel", exportMembersExcel);

// attended/missed events lists
router.get("/:id/attendance", getMemberAttendanceDetails);

// get by id
router.get("/:id", getMemberById);

// update member
router.put("/:id", updateMember);

// deactivate member (super admin only)
router.patch("/:id/deactivate", requireRole("SUPER_ADMIN"), deactivateMember);

// resend QR email
router.post("/:id/resend-qr", resendMemberQr);

// activate member (super admin only)
router.patch("/:id/activate", requireRole("SUPER_ADMIN"), activateMember);

export default router;
