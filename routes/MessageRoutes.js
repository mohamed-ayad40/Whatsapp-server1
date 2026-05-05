import { Router } from "express";
import { addAudioMessage, addImageMessage, addMessage, deleteMessage, editMessage, getInitialContactsWithMessages, getMessages } from "../controllers/MessageController.js";
import upload from "../middlewares/multer.js";
import rateLimit from "express-rate-limit"; // المكتبة الجديدة
import { verifyToken } from "../middlewares/AuthMiddleware.js"; // استدعينا الحارس


const router = Router();

// --- حارس الـ Rate Limit ---
// بيسمح لليوزر (IP) يبعت 60 رسالة بحد أقصى في الدقيقة الواحدة
const sendMessageLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // دقيقة واحدة
    max: 60, // أقصى عدد طلبات
    message: { error: "Too many messages sent. Please wait a minute." }, // الرسالة اللي هترجع للهاكر
    standardHeaders: true,
    legacyHeaders: false,
});
// -----------------------------

// حطينا verifyToken قبل كل الدوال عشان محدش يدخل غير لو معاه التذكرة
router.post("/add-message", verifyToken, sendMessageLimiter, addMessage);
router.get("/get-messages/:from/:to", verifyToken, getMessages);
router.post("/add-image-message", verifyToken, upload.single("image"), addImageMessage);
router.post("/add-audio-message", verifyToken, upload.single("audio"), addAudioMessage);
router.get("/get-initial-contacts/:from", verifyToken, getInitialContactsWithMessages);
// ... (الراوتس القديمة)
router.post("/edit-message", verifyToken, editMessage);
router.post("/delete-message", verifyToken, deleteMessage);


export default router;