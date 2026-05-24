import { Router } from "express";
import { checkUser, generateToken, getAllUsers, onBoardUser, toggleBlockUser, updateUser } from "../controllers/AuthController.js";

const router = Router();
router.post("/check-user", checkUser);
router.post("/onboard-user", onBoardUser);
router.get("/get-contacts", getAllUsers);
router.get("/generate-token/:userId", generateToken);
router.post("/toggle-block", toggleBlockUser);
router.post("/update-user", updateUser);
export default router;