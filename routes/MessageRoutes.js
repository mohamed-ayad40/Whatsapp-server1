import { Router } from "express";
import { addAudioMessage, addImageMessage, addMessage, getInitialContactsWithMessages, getMessages } from "../controllers/MessageController.js";
// import multer from "multer";
import upload from "../middlewares/multer.js";
const router = Router();

// const upload = multer({dest: "uploads/recordings"})
// const uploadImage = multer({dest: "uploads/images"})

router.post("/add-message", addMessage);
router.get("/get-messages/:from/:to", getMessages);
router.post("/add-image-message", upload.single("image"), addImageMessage);
router.post("/add-audio-message", upload.single("audio"), addAudioMessage);
router.get("/get-initial-contacts/:from", getInitialContactsWithMessages);

export default router;