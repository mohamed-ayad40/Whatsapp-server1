import { Server } from "socket.io";
import getPrismaInstance from "./PrismaClient.js";

export const initSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: [
                "https://whatsapp-client-delta.vercel.app", 
                "http://localhost:3000", 
                "https://localhost:3000", 
                "https://localhost:3001"
            ],
            methods: "GET,POST,PUT,DELETE,OPTIONS",
        },
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
            socket.userId = userId; 

            try {
                const prisma = getPrismaInstance();
                const pendingMessages = await prisma.messages.findMany({
                    where: { receiverId: userId, messageStatus: "sent" },
                    select: { id: true, senderId: true }
                });

                if (pendingMessages.length > 0) {
                    await prisma.messages.updateMany({
                        where: { receiverId: userId, messageStatus: "sent" },
                        data: { messageStatus: "delivered" }
                    });

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
            socket.join(chatId);
            console.log(`${userId} joined chat ${chatId}`);
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
            socket.leave(chatId);
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

            try {
                const prisma = getPrismaInstance();
                await prisma.messages.updateMany({
                    where: {
                        senderId: data.to,
                        receiverId: data.from,
                        messageStatus: { in: ["sent", "delivered"] },
                    },
                    data: { messageStatus: "read" },
                });
            } catch (error) {
                console.log("Error updating message status on seen:", error);
            }
        });

        socket.on('disconnect', async function() {
            console.log("Client Disconnected");
            
            if (socket.userId) {
                const userId = socket.userId;
                onlineUsers.delete(userId); 
                
                try {
                    const prisma = getPrismaInstance();
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
            }

            socket.broadcast.emit("online-users", {
                onlineUsers: Array.from(onlineUsers.keys())
            });
        });

        socket.on("signout", async (id) => {
            if (id) {
                onlineUsers.delete(id);

                try {
                    const prisma = getPrismaInstance();
                    const currentTime = new Date().toISOString();

                    await prisma.user.update({
                        where: { id: id },
                        data: { lastSeen: currentTime }
                    });

                    socket.broadcast.emit("user-offline", { 
                        userId: id, 
                        lastSeen: currentTime 
                    });

                    socket.broadcast.emit("online-users", {
                        onlineUsers: Array.from(onlineUsers.keys())
                    });

                } catch (error) {
                    console.log("Error during signout socket event:", error);
                }
            }
        });

        socket.on("trigger-typing", (data) => {
            socket.broadcast.emit("receive-typing", {
                from: data.from,
                to: data.to,
                typing: data.typing
            });
        });

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

                        io.to(groupId).emit("group-msg-seen-update", { 
                            messageId: msg.id, 
                            seenCount: seenCount,
                            groupId: groupId 
                        });

                        if (seenCount >= (group.userIds.length - 1)) {
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
                const receiver = await prisma.user.findUnique({
                    where: { id: data.to },
                    select: { blockedUsers: true }
                });

                if (receiver?.blockedUsers?.includes(data.from)) {
                    return; 
                }

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
            
            if (receiver?.blockedUsers?.includes(data.from)) return;

            const sendUserSocket = onlineUsers.get(data.to);
            if(sendUserSocket) {
                socket.to(sendUserSocket).emit("incoming-voice-call", {
                    from: data.from, roomId: data.roomId, callType: data.callType
                });
            }
        });

        socket.on("outgoing-video-call", async (data) => {
            const prisma = getPrismaInstance();
            const receiver = await prisma.user.findUnique({ where: { id: data.to }, select: { blockedUsers: true } });
            
            if (receiver?.blockedUsers?.includes(data.from)) return;

            const sendUserSocket = onlineUsers.get(data.to);
            if(sendUserSocket) {
                socket.to(sendUserSocket).emit("incoming-video-call", {
                    from: data.from, roomId: data.roomId, callType: data.callType
                });
            }
        });

        socket.on("reject-voice-call", (data) => {
            const sendUserSocket = onlineUsers.get(data.from);
            if (sendUserSocket) {
                socket.to(sendUserSocket).emit("voice-call-rejected");
            }
        });

        socket.on("reject-video-call", (data) => {
            const sendUserSocket = onlineUsers.get(data.from);
            if (sendUserSocket) {
                socket.to(sendUserSocket).emit("video-call-rejected");
            }
        });

        socket.on("accept-incoming-call", ({id}) => {
            const sendUserSocket = onlineUsers.get(id);
            socket.to(sendUserSocket).emit("accept-call");
        });
        
    });

    io.engine.on("connection_error", (err) => {
        console.log(err.code); 
        console.log(err.message);
    });
};