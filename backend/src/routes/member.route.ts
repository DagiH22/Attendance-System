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

// create member
router.post("/", createMember);

// get all members
router.get("/", getAllMembers);

// search and get by name or uniqueId (case-insensitive)
router.get("/search", searchMembers);

// get by id
router.get("/:id", getMemberById);

export default router;
