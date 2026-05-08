import { Router } from "express";
import { createGroup } from "../controllers/GroupController.js";
// لو عندك Middleware للتأكد من التوكن (زي اللي بتستخدمه في الشات الفردي) ضيفه هنا
// import { verifyToken } from "../middlewares/AuthMiddleware.js"; 

const router = Router();

// روت إنشاء الجروب (يفضل تحط الـ Middleware بتاع الـ Auth لو موجود)
router.post("/create-group", createGroup);

export default router;