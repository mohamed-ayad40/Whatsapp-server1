import express from "express"
import dotenv from "dotenv";
import cors from "cors";
import AuthRoutes from "./routes/AuthRoutes.js";
import MessageRoute from "./routes/MessageRoutes.js";
import { Server } from "socket.io";
import { getMessages } from "./controllers/MessageController.js";
import connectCloudinary from "./config/cloudinary.js";
import getPrismaInstance from "./utils/PrismaClient.js";
import helmet from "helmet"; // ضيف ده مع الـ imports فوق
import GroupRoutes from "./routes/GroupRoutes.js";

dotenv.config();
const app = express();
app.use(helmet()); // ضيف السطر ده هنا تحت تعريف الـ app مباشرة

connectCloudinary();
app.use(cors({
    origin: ["https://whatsapp-client-delta.vercel.app", "http://localhost:3000", "https://localhost:3000", "https://localhost:3001"],
    credentials: true, // Allow cookies and credentials
    methods: "GET,POST,PUT,DELETE,OPTIONS", // Allow necessary methods
    addTrailingSlash: false,
    // preflightContinue: true,
    // allowedHeaders: "Content-Type, Authorization, Accept", // Allow necessary headers
}));
app.use(express.json());
// app.use("/uploads/recordings", express.static("uploads/recordings"))
// app.use("/uploads/images", express.static("uploads/images"))
app.use("/api/auth", AuthRoutes);
app.use("/api/messages", MessageRoute);
app.use("/api/groups", GroupRoutes);
app.get("/", (req, res) => {
    res.send("Hello client");
})
const server = app.listen(process.env.PORT || 7860, () => {
    console.log("Server Started on port 7860!");
});

const io = new Server(server, {
    cors: {
        origin: ["https://whatsapp-client-delta.vercel.app", "http://localhost:3000", "https://localhost:3000", "https://localhost:3001"],
        // credentials: true, // Allow cookies and credentials
        methods: "GET,POST,PUT,DELETE,OPTIONS", // Allow necessary methods
        // preflightContinue: true,
        // allowedHeaders: "Content-Type, Authorization, Accept", // Allow necessary headersrs: "Content-Type, Authorization, Accept", // Allow necessary headers
    },
    // transports: ['websocket', 'polling'], // Allow fallback
    path: '/socket.io',
    addTrailingSlash: false,
});


global.onlineUsers = new Map();
global.io = io;
io.on("connection", (socket) => {
    console.log("Connected to socket");
    global.chatSocket = socket;
    socket.on("add-user", async (userId) => {
        onlineUsers.set(userId, socket.id);
        
        // حدّث الرسايل اللي اتبعتله وهو أوفلاين لـ delivered
        try {
            const prisma = getPrismaInstance();
            const pendingMessages = await prisma.messages.findMany({
                where: {
                    receiverId: userId,
                    messageStatus: "sent"
                },
                select: { id: true, senderId: true }
            });

            if (pendingMessages.length > 0) {
                await prisma.messages.updateMany({
                    where: {
                        receiverId: userId,
                        messageStatus: "sent"
                    },
                    data: { messageStatus: "delivered" }
                });

                // بلّغ كل سيندر إن رسالته delivered
                const senderIds = [...new Set(pendingMessages.map(m => m.senderId))];
                senderIds.forEach(senderId => {
                    const senderSocket = onlineUsers.get(senderId);
                    if (senderSocket) {
                        global.io.to(senderSocket).emit("msg-delivered", { to: userId });
                    }
                });
            }
        } catch (err) {
            console.log("Error updating pending messages:", err);
        }

        socket.broadcast.emit("online-users", {
            onlineUsers: Array.from(onlineUsers.keys())
        });
    });

    socket.on("join-chat", ({ userId, chatId }) => {
        socket.join(chatId); // Join the chat room
        console.log(`${userId} joined chat ${chatId}`);
    
        // Track the user in the room (optional, for debugging)
        socket.broadcast.to(chatId).emit("user-joined", { userId });
    });

    // ==========================================
    // تمرير إشارات WebRTC (Peer-to-Peer Signaling)
    // ==========================================
    socket.on("webrtc-offer", (data) => {
        const sendUserSocket = onlineUsers.get(data.to);
        if (sendUserSocket) {
            socket.to(sendUserSocket).emit("webrtc-offer-received", data.offer);
        }
    });

    socket.on("webrtc-answer", (data) => {
        const sendUserSocket = onlineUsers.get(data.to);
        if (sendUserSocket) {
            socket.to(sendUserSocket).emit("webrtc-answer-received", data.answer);
        }
    });

    socket.on("webrtc-ice-candidate", (data) => {
        const sendUserSocket = onlineUsers.get(data.to);
        if (sendUserSocket) {
            socket.to(sendUserSocket).emit("webrtc-ice-candidate-received", data.candidate);
        }
    });

    socket.on("leave-chat", ({ userId, chatId }) => {
        socket.leave(chatId); // Leave the chat room
        console.log(`${userId} left chat ${chatId}`);
        socket.broadcast.to(chatId).emit("user-left", { userId });
    });

    socket.on("msg-seen", async (data) => {
        const sendUserSocket = onlineUsers.get(data.to);
        if (sendUserSocket) {
            global.io.to(sendUserSocket).emit("refresh-seen", {
                readerId: data.from 
            });
        }

        // --- التعديل الجديد: تحديث الداتا بيز عشان الـ Seen يفضل محفوظ بعد الريفريش ---
        try {
            const prisma = getPrismaInstance();
            await prisma.messages.updateMany({
                where: {
                    senderId: data.to,     // الشخص اللي بعت الرسالة
                    receiverId: data.from, // أنت (اللي قرأ الرسالة)
                    messageStatus: { in: ["sent", "delivered"] },
                },
                data: { messageStatus: "read" },
            });
        } catch (error) {
            console.log("Error updating message status on seen:", error);
        }
        // -------------------------------------------------------------
    });

    // خلينا الـ function دي async عشان نقدر نكلم الداتا بيز
    socket.on('disconnect', async function(data) {
        for (let [userId, sockId] of onlineUsers.entries()) {
            if (sockId === socket.id) {
                onlineUsers.delete(userId);
                
                try {
                    const prisma = getPrismaInstance();
                    // التعديل: نستخدم ISO String فوراً
                    const currentTime = new Date().toISOString(); 
                    
                    await prisma.user.update({
                        where: { id: userId },
                        data: { lastSeen: currentTime }
                    });
                    
                    socket.broadcast.emit("user-offline", { 
                        userId: userId, 
                        lastSeen: currentTime 
                    });
                } catch (error) {
                    console.log("Error updating last seen:", error);
                }
                break;
            }
        }
        socket.broadcast.emit("online-users", {
            onlineUsers: Array.from(onlineUsers.keys())
        });
    });
    socket.on("signout", async (id) => {
        if (id) {
            // 1. مسح اليوزر من قائمة الـ Online
            onlineUsers.delete(id);

            try {
                const prisma = getPrismaInstance();
                const currentTime = new Date().toISOString();

                // 2. تحديث وقت الخروج في الداتا بيز (Last Seen)
                await prisma.user.update({
                    where: { id: id },
                    data: { lastSeen: currentTime }
                });

                // 3. تبليغ باقي اليوزرز إن اليوزر ده قفل (user-offline)
                // دي اللي بتخلي الـ Last Seen يظهر "الآن" عند الناس التانية
                socket.broadcast.emit("user-offline", { 
                    userId: id, 
                    lastSeen: currentTime 
                });

                // 4. تحديث قائمة الـ Online للكل
                socket.broadcast.emit("online-users", {
                    onlineUsers: Array.from(onlineUsers.keys())
                });

            } catch (error) {
                console.log("Error during signout socket event:", error);
            }
        }
    });

    socket.on("trigger-typing", (data) => {
        console.log("Is typing")
        socket.broadcast.emit("receive-typing", {
            from: data.from, //who is writing
            to: data.to,//writing to who
            typing: data.typing
        })
    })

    socket.on("group-msg-seen", async ({ userId, groupId }) => {
        try {
            if (!userId || !groupId) return; 

            const prisma = getPrismaInstance();

            const unseenMessages = await prisma.messages.findMany({
                where: {
                    groupId: groupId,
                    senderId: { not: userId },
                    seenBy: { none: { userId: userId } }
                },
                select: { id: true }
            });

            if (unseenMessages.length > 0) {
                await prisma.messageSeen.createMany({
                    data: unseenMessages.map(msg => ({
                        messageId: msg.id,
                        userId: userId
                    })),
                });

                const group = await prisma.group.findUnique({
                    where: { id: groupId },
                    select: { userIds: true }
                });

                for (const msg of unseenMessages) {
                    const seenCount = await prisma.messageSeen.count({
                        where: { messageId: msg.id }
                    });

                    // 🚨 التعديل السحري: إرسال تحديث للعداد لايف لكل أعضاء الجروب
                    io.to(groupId).emit("group-msg-seen-update", { 
                        messageId: msg.id, 
                        seenCount: seenCount,
                        groupId: groupId 
                    });

                    if (seenCount >= (group.userIds.length - 1)) {
                        // 🚨 التعديل السحري: تحديث الرسالة في الداتا بيز لـ read عشان متقلبش رمادي تاني
                        await prisma.messages.update({
                            where: { id: msg.id },
                            data: { messageStatus: "read" }
                        });

                        io.to(groupId).emit("group-msg-blue-ticks", { 
                            messageId: msg.id, 
                            groupId: groupId 
                        });
                    }
                }
            }
        } catch (error) {
            console.log("Error in group-msg-seen:", error);
        }
    });

    socket.on("group-msg-delivered-ack", async ({ messageId, groupId, senderId }) => {
        try {
            const prisma = getPrismaInstance();
            const msg = await prisma.messages.findUnique({ where: { id: messageId }, select: { messageStatus: true } });
            
            if (msg && msg.messageStatus === "sent") {
                await prisma.messages.update({
                    where: { id: messageId },
                    data: { messageStatus: "delivered" }
                });
                const senderSocket = onlineUsers.get(senderId);
                if (senderSocket) {
                    global.io.to(senderSocket).emit("group-msg-delivered-update", { messageId, groupId });
                }
            }
        } catch (e) { console.error(e); }
    });

    socket.on("send-msg", async (data) => {
        try {
            const prisma = getPrismaInstance();
            // تشييك السيكيوريتي: هل المستلم عامل بلوك للمرسل؟
            const receiver = await prisma.user.findUnique({
                where: { id: data.to },
                select: { blockedUsers: true }
            });

            // لو المستلم عاملك بلوك، ارمي الرسالة في البحر واعمل return
            if (receiver?.blockedUsers?.includes(data.from)) {
                return; 
            }

            // لو مفيش بلوك، كمل طبيعي
            const sendUserSocket = onlineUsers.get(data.to);
            if (data.groupId) {
                socket.to(data.groupId).emit("msg-receive", { from: data.from, message: data.message, isGroup: true });
                socket.to(data.groupId).emit("msg-send-refresh", { triggered: true, newMessage: data.message });
            } else if (sendUserSocket) {
                socket.to(sendUserSocket).emit("msg-receive", { from: data.from, message: data.message });
                socket.to(sendUserSocket).emit("msg-send-refresh", { triggered: true, newMessage: data.message });
            }
        } catch (err) {
            console.log(err);
        }
    });
    socket.on("outgoing-voice-call", async (data) => {
        const prisma = getPrismaInstance();
        const receiver = await prisma.user.findUnique({ where: { id: data.to }, select: { blockedUsers: true } });
        
        // لو معموله بلوك، المكالمة مش هتروح أصلاً
        if (receiver?.blockedUsers?.includes(data.from)) return;

        const sendUserSocket = onlineUsers.get(data.to);
        if(sendUserSocket) {
            socket.to(sendUserSocket).emit("incoming-voice-call", {
                from: data.from, roomId: data.roomId, callType: data.callType
            });
        };
    });

    // 3. تأمين مكالمات الفيديو
    socket.on("outgoing-video-call", async (data) => {
        const prisma = getPrismaInstance();
        const receiver = await prisma.user.findUnique({ where: { id: data.to }, select: { blockedUsers: true } });
        
        // لو معموله بلوك، المكالمة مش هتروح أصلاً
        if (receiver?.blockedUsers?.includes(data.from)) return;

        const sendUserSocket = onlineUsers.get(data.to);
        if(sendUserSocket) {
            socket.to(sendUserSocket).emit("incoming-video-call", {
                from: data.from, roomId: data.roomId, callType: data.callType
            });
        };
    });
    socket.on("reject-voice-call", (data) => {
        const sendUserSocket = onlineUsers.get(data.from);
        if (sendUserSocket) {
            console.log("Got reject voice");
            socket.to(sendUserSocket).emit("voice-call-rejected");
        };
    });
    socket.on("reject-video-call", (data) => {
        const sendUserSocket = onlineUsers.get(data.from);
        if (sendUserSocket) {
            console.log("Got reject video");
            socket.to(sendUserSocket).emit("video-call-rejected");
        };
    });
    socket.on("accept-incoming-call", ({id}) => {
        const sendUserSocket = onlineUsers.get(id);
        socket.to(sendUserSocket).emit("accept-call");
    });
    
});
io.engine.on("connection_error", (err) => {
    console.log(err.req);      // the request object
    console.log(err.code);     // the error code, for example 1
    console.log(err.message);  // the error message, for example "Session ID unknown"
    console.log(err.context);  // some additional error context
});
