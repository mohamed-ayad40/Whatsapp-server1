import admin from "firebase-admin";
import { readFileSync } from "fs";
import getPrismaInstance from "../utils/PrismaClient.js";

// تهيئة Firebase Admin
const serviceAccount = JSON.parse(readFileSync(new URL("../firebaseServiceAccount.json", import.meta.url)));
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

export const verifyToken = async (req, res, next) => {
    try {
        // 1. نتأكد إن التوكن مبعوت أصلاً
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).send("Access Denied: No token provided!");

        // 2. نفك التشفير بتاع التوكن ونتأكد إنه من Firebase
        const decodedToken = await admin.auth().verifyIdToken(token);
        const userEmail = decodedToken.email;

        // 3. نجيب الـ ID بتاع اليوزر من الداتا بيز بناءً على إيميله
        const prisma = getPrismaInstance();
        const user = await prisma.user.findUnique({ where: { email: userEmail } });
        if (!user) return res.status(404).send("User not found in database.");

        // 4. الحماية المنطقية (Authorization)
        // نتأكد إن اليوزر بيطلب داتا تخصه هو، مش بيسرق داتا حد تاني
        const requestFromId = req.params.from || req.body.from || req.query.from;
        if (requestFromId && requestFromId !== user.id) {
            return res.status(403).send("Forbidden: You can only access your own messages!");
        }

        // لو كله تمام، نعديه للـ Controller
        req.user = user;
        next();

    } catch (error) {
        console.error("Auth Middleware Error:", error);
        return res.status(403).send("Invalid or expired token.");
    }
};