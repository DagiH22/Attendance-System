import { Router } from "express";
import {
  createMember,
  getAllMembers,
  getMemberById,
  searchMembers,
} from "../controllers/member.controller";
import verifyAuth from "../middleware/auth.middleware";

const router = Router();

// All member routes require authentication
router.use(verifyAuth);

// POST / -> create member
router.post("/", createMember);

// GET / -> all members
router.get("/", getAllMembers);

// GET /search?q=... -> search by name or uniqueId (case-insensitive)
router.get("/search", searchMembers);

// GET /:id -> get by id
router.get("/:id", getMemberById);

export default router;
