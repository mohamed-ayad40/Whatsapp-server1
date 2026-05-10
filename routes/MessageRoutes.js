import { Router } from "express";
import { addAudioMessage, addImageMessage, addMessage, deleteMessage, editMessage, getInitialContactsWithMessages, getMessages, getGroupMedia } from "../controllers/MessageController.js";
import upload from "../middlewares/multer.js";
import rateLimit from "express-rate-limit";
import { verifyToken } from "../middlewares/AuthMiddleware.js";

const router = Router();

const sendMessageLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 60,
    message: { error: "Too many messages sent. Please wait a minute." },
    standardHeaders: true,
    legacyHeaders: false,
});

router.post("/add-message", verifyToken, sendMessageLimiter, addMessage);
router.get("/get-messages/:from/:to", verifyToken, getMessages);
router.post("/add-image-message", verifyToken, upload.single("image"), addImageMessage);
router.post("/add-audio-message", verifyToken, upload.single("audio"), addAudioMessage);
router.get("/get-initial-contacts/:from", verifyToken, getInitialContactsWithMessages);
router.post("/edit-message", verifyToken, editMessage);
router.post("/delete-message", verifyToken, deleteMessage);

// الراوت الجديد لمعرض الميديا
router.get("/get-group-media/:groupId", verifyToken, getGroupMedia);

export default router;