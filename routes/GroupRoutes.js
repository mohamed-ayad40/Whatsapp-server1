import { Router } from "express";
import { createGroup, toggleGroupLock, toggleAdminRole, removeMember, addGroupMembers } from "../controllers/GroupController.js";
// لو عندك Middleware للتأكد من التوكن (زي اللي بتستخدمه في الشات الفردي) ضيفه هنا
import { verifyToken } from "../middlewares/AuthMiddleware.js"; 

const router = Router();

// روت إنشاء الجروب (يفضل تحط الـ Middleware بتاع الـ Auth لو موجود)
router.post("/create-group", createGroup);
router.post("/toggle-lock", verifyToken, toggleGroupLock);
router.post("/toggle-admin", verifyToken, toggleAdminRole);
router.post("/remove-member", verifyToken, removeMember);
router.post("/add-members", verifyToken, addGroupMembers);

export default router;