import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import AuthRoutes from "./routes/AuthRoutes.js";
import MessageRoute from "./routes/MessageRoutes.js";
import GroupRoutes from "./routes/GroupRoutes.js";
import connectCloudinary from "./config/cloudinary.js";
import helmet from "helmet";
import { initSocket } from "./socket.js"; // 👈 استيراد ملف السوكيت المنفصل

dotenv.config();
const app = express();

app.use(helmet());
connectCloudinary();

app.use(cors({
    origin: ["https://whatsapp-client-delta.vercel.app", "http://localhost:3000", "https://localhost:3000", "https://localhost:3001"],
    credentials: true,
    methods: "GET,POST,PUT,DELETE,OPTIONS",
    addTrailingSlash: false,
}));

app.use(express.json());

// Routes
app.use("/api/auth", AuthRoutes);
app.use("/api/messages", MessageRoute);
app.use("/api/groups", GroupRoutes);

app.get("/", (req, res) => {
    res.send("Hello client");
});

// تشغيل سيرفر الـ HTTP
const server = app.listen(process.env.PORT || 7860, () => {
    console.log(`Server Started on port ${process.env.PORT || 7860}!`);
});

// 🚨 تشغيل السوكيت وربطه بالـ HTTP سيرفر
initSocket(server);