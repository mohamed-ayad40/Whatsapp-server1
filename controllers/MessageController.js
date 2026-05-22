import getPrismaInstance from "../utils/PrismaClient.js";
import {unlink} from "fs/promises";
import {v2 as cloudinary} from "cloudinary";
import sanitizeHtml from "sanitize-html";

export const addMessage = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        let { message, from, to, replyTo, groupId } = req.body;

        if (message && from && (to || groupId)) {
            
            const cleanMessage = sanitizeHtml(message, {
                allowedTags: [], 
                allowedAttributes: {}
            });

            if (!cleanMessage.trim()) {
                return res.status(400).send("Invalid message format.");
            }

            const newMessage = await prisma.messages.create({
                data: {
                    message: cleanMessage,
                    senderId: from,
                    receiverId: to || null,
                    groupId: groupId || null,
                    messageStatus: "sent", // دايماً sent أول ما تتخزن
                    replyToId: replyTo || null,
                },
                include: {
                    sender: true,
                    receiver: true,
                    replyTo: true,
                    group: true 
                }
            });

            if (groupId) {
                global.io.to(groupId).emit("msg-receive", { from, message: newMessage, isGroup: true });
            } else {
                await handleDeliveryStatus(prisma, newMessage, from, to, groupId); // هنا
            }

            return res.status(201).json({ message: newMessage });
        }

        return res.status(400).send("Message, From, and (To or GroupId) are required.");
    } catch (err) {
        next(err);
    }
};

export const getMessages = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { from, to } = req.params;
        const { cursor } = req.query; 

        if (from === "undefined" || to === "undefined") return res.status(400).send("Invalid User IDs");

        let messages = await prisma.messages.findMany({
            where: {
                OR: [
                    { senderId: from, receiverId: to },
                    { senderId: to, receiverId: from },
                    { groupId: to }, 
                ],
            },
            include: { replyTo: true, sender: true, _count: { select: { seenBy: true }} },
            orderBy: {
                id: 'desc', // بنجيب أحدث الرسايل
            },
            take: 40,
            ...(cursor && cursor !== "undefined" && cursor !== "null" && {
                cursor: { id: cursor },
                skip: 1, 
            }),
        });

        const fetchedCount = messages.length;

        messages = messages.filter((msg) => {
            return !(msg.deletedBy && msg.deletedBy.includes(from));
        });

        // 🚨 التعديل السحري: شيلنا الـ reverse() من هنا تماماً!
        // هنسيب الرسايل تروح للفرونت إند مترتبة من الأحدث للأقدم (زي ما رجعت من Prisma)

        const unreadMessageIds = messages
            .filter((message) => message.messageStatus !== 'read' && message.senderId === to)
            .map((message) => message.id);

        if (unreadMessageIds.length > 0) {
             await prisma.messages.updateMany({
            where: {
                senderId: to,
                receiverId: from,
                messageStatus: { in: ["sent", "delivered"] }
            },
            data: { messageStatus: 'read' },
        });

        messages.forEach((message) => {
            if (message.messageStatus !== 'read' && message.senderId === to) {
                message.messageStatus = 'read';
            }
        });
        }

        const senderSocket = global.onlineUsers.get(to);
        if (senderSocket) {
            global.io.to(senderSocket).emit("refresh-seen", { readerId: from });
        }

        res.status(200).json({
            messages,
            // 🚨 تحديث مهم: عشان شيلنا الـ reverse، الـ Cursor الصح هو آخر رسالة في الأراي (أقدم واحدة في الباتش)
            nextCursor: messages.length > 0 ? messages[messages.length - 1].id : null,
            hasMore: fetchedCount === 40, 
        });

    } catch (err) {
        next(err);
    }
};

export const addImageMessage = async (req, res, next) => {
    try {
        if(req.file) {
            const imageFile = req.file;
            const imageUpload = await cloudinary.uploader.upload(imageFile.path, {resource_type: "image"});
            try { unlink(imageFile.path); } catch (err) { console.error("Failed to delete local image:", err); }
            
            const prisma = getPrismaInstance();
            const {from, to, groupId} = req.query;
            
            if(from && (to || groupId)) {
                const message = await prisma.messages.create({
                    data: {
                        message: imageUpload.secure_url,
                        sender: {connect: {id: from}}, 
                        ...(to && to !== "undefined" && { receiver: {connect: {id: to}} }),
                        ...(groupId && groupId !== "undefined" && { group: {connect: {id: groupId}} }),
                        type: "image",
                        messageStatus: "sent", // دايماً sent الأول
                    }
                });

                if (!groupId) {
                    await handleDeliveryStatus(prisma, message, from, to, groupId);
                }
                return res.status(201).json({ message });
            }
            return res.status(400).send("From and (To or GroupId) is required.");
        }
        return res.status(400).send("Image is required.");
    } catch (err) { next(err); }
};

export const addAudioMessage = async (req, res, next) => {
    try {
        if(req.file) {
            const audioFile = req.file;
            const audioUpload = await cloudinary.uploader.upload(audioFile.path, {resource_type: "video"});
            try { unlink(audioFile.path); } catch (err) { console.error("Failed to delete local audio:", err); }
            
            const prisma = getPrismaInstance();
            const {from, to, groupId} = req.query;

            if(from && (to || groupId)) {
                const message = await prisma.messages.create({
                    data: {
                        message: audioUpload.secure_url,
                        sender: {connect: {id: from}}, 
                        ...(to && to !== "undefined" && { receiver: {connect: {id: to}} }),
                        ...(groupId && groupId !== "undefined" && { group: {connect: {id: groupId}} }),
                        type: "audio",
                        messageStatus: "sent", // دايماً sent الأول
                    }
                });

                if (!groupId) {
                    await handleDeliveryStatus(prisma, message, from, to, groupId);
                }

                return res.status(201).json({ message });
            }
            return res.status(400).send("From and (To or GroupId) is required.");
        }
        return res.status(400).send("Audio is required.");
    } catch (err) { next(err); }
};

export const getInitialContactsWithMessages = async (req, res, next) => {
    try {
        const userId = req.params.from;
        const prisma = getPrismaInstance();

        const messages = await prisma.messages.findMany({
            where: {
                OR: [{ senderId: userId }, { receiverId: userId }], groupId: null,
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                type: true,
                message: true,
                messageStatus: true,
                createdAt: true,
                senderId: true,
                receiverId: true,
                sender: { select: { id: true, name: true, profilePicture: true, email: true, about: true, lastSeen: true } },
                receiver: { select: { id: true, name: true, profilePicture: true, email: true, about: true, lastSeen: true } },
            },
        });

        const users = new Map();
        const messageStatusChange = [];

        messages.forEach((msg) => {
            const isSender = msg.senderId === userId;
            const calculatedId = isSender ? msg.receiverId : msg.senderId;

            if (msg.messageStatus === "sent") {
                messageStatusChange.push(msg.id);
            }

            if (!users.has(calculatedId)) {
                let user = { 
                    id: calculatedId, type: msg.type, message: msg.message, 
                    messageStatus: msg.messageStatus, createdAt: msg.createdAt, 
                    senderId: msg.senderId, receiverId: msg.receiverId 
                };

                if (isSender) {
                    user = { ...user, ...msg.receiver, totalUnreadMessages: 0 };
                } else {
                    user = { ...user, ...msg.sender, totalUnreadMessages: msg.messageStatus !== "read" ? 1 : 0 };
                }
                users.set(calculatedId, user);
            } else if (msg.messageStatus !== "read" && !isSender) {
                const user = users.get(calculatedId);
                user.totalUnreadMessages += 1;
            }
        });

        // بعد - صح ✅
        if (messageStatusChange.length) {
            // بس حول لـ delivered لو المستقبل أونلاين فعلاً
            const onlineMessageIds = [];

            for (const msg of messages) {
                if (messageStatusChange.includes(msg.id)) {
                    const receiverId = msg.senderId === userId ? msg.receiverId : msg.senderId;
                    if (receiverId && global.onlineUsers.has(receiverId)) {
                        onlineMessageIds.push(msg.id);
                    }
                }
            }

            if (onlineMessageIds.length > 0) {
                await prisma.messages.updateMany({
                    where: { id: { in: onlineMessageIds } },
                    data: { messageStatus: "delivered" },
                });
            }
        }

        const userGroups = await prisma.group.findMany({
            where: { userIds: { has: userId } },
            include: {
                users: { select: { id: true, name: true, profilePicture: true, email: true } },
                // الإضافة: جلب المفتاح المتشفر الخاص بهذا اليوزر فقط في هذا الجروب
                encryptedKeys: {
                    where: { userId: userId },
                    select: { encryptedKey: true }
                }
            }
        });

        userGroups.forEach((group) => {
            if (!users.has(group.id)) {
                users.set(group.id, {
                    id: group.id,
                    name: group.name,
                    profilePicture: group.profilePicture || "/default_avatar.png",
                    about: group.about,
                    isGroup: true,
                    isLocked: group.isLocked, // السطر ده هو اللي هيخلي الحالة تثبت بعد الـ Refresh
                    users: group.users,
                    adminIds: group.adminIds,
                    type: "text",
                    message: "Tap to view group",
                    messageStatus: "read",
                    createdAt: group.createdAt,
                    totalUnreadMessages: 0,
                    senderId: group.id,
                    receiverId: userId,
                    encryptedKey: group.encryptedKeys[0]?.encryptedKey || null,
                });
            }
        });

        return res.status(200).json({
            users: Array.from(users.values()),
            onlineUsers: Array.from(global.onlineUsers.keys()),
        });
    } catch (err) {
        next(err);
    }
};

export const updateMessageStatusAndUnreadCount = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { from, to } = req.body;

        await prisma.messages.updateMany({
            where: {
            senderId: to,  
            receiverId: from, 
            messageStatus: { in: ["sent", "delivered"] },
            },
            data: { messageStatus: "read" },
        });

        const unreadCount = await prisma.messages.count({
            where: {
            receiverId: from,  
            messageStatus: { not: "read" },  
            },
        });

        return res.status(200).json({
            message: "Status and unread messages updated successfully",
            unreadCount,  
        });
    } catch (err) {
        next(err);
    }
};

export const editMessage = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { messageId, newMessage } = req.body;
        const userId = req.user.id; 

        const msg = await prisma.messages.findUnique({ where: { id: messageId } });

        if (!msg) return res.status(404).send("Message not found.");
        if (msg.senderId !== userId) return res.status(403).send("You can only edit your own messages.");
        if (msg.isDeleted) return res.status(400).send("Cannot edit a deleted message.");
        if (msg.type !== "text") return res.status(400).send("Only text messages can be edited.");

        const timeDifference = Date.now() - new Date(msg.createdAt).getTime();
        if (timeDifference > 15 * 60 * 1000) {
            return res.status(400).send("Time limit exceeded. You can only edit messages within 15 minutes.");
        }

        const updatedMessage = await prisma.messages.update({
            where: { id: messageId },
            data: { 
                message: newMessage, 
                isEdited: true 
            },
            include: { sender: true, receiver: true }
        });

        if (msg.groupId) {
            global.io.to(msg.groupId).emit("message-edited", updatedMessage);
        } else if (msg.receiverId) {
            const receiverSocket = global.onlineUsers.get(msg.receiverId);
            if (receiverSocket) {
                global.io.to(receiverSocket).emit("message-edited", updatedMessage);
            }
        }

        return res.status(200).json({ message: updatedMessage });
    } catch (err) {
        next(err);
    }
};

export const deleteMessage = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { messageId, type } = req.body; 
        const userId = req.user.id;

        const msg = await prisma.messages.findUnique({ where: { id: messageId }, include: { group: true } });
        if (!msg) return res.status(404).send("Message not found.");

        const isOwner = msg.senderId === userId;
        const isAdmin = msg.groupId && msg.group.adminIds.includes(userId);

        let updatedMessage;

        if (type === "everyone") {
            if (!isOwner && !isAdmin) {
                return res.status(403).send("Only the sender or a group admin can delete for everyone.");
            }
            
            updatedMessage = await prisma.messages.update({
                where: { id: messageId },
                data: { 
                    message: "This message was deleted", 
                    isDeleted: true 
                }
            });

            if (msg.groupId) {
                global.io.to(msg.groupId).emit("message-deleted", updatedMessage);
            } else if (msg.receiverId) {
                const receiverId = msg.senderId === userId ? msg.receiverId : msg.senderId;
                const receiverSocket = global.onlineUsers.get(receiverId);
                if (receiverSocket) {
                    global.io.to(receiverSocket).emit("message-deleted", updatedMessage);
                }
            }

        } else if (type === "me") {
            updatedMessage = await prisma.messages.update({
                where: { id: messageId },
                data: {
                    deletedBy: { push: userId }
                }
            });
        } else {
            return res.status(400).send("Invalid delete type.");
        }

        return res.status(200).json({ message: updatedMessage });
    } catch (err) {
        next(err);
    }
};

// --- الدالة الجديدة لجلب ميديا الجروب ---
export const getGroupMedia = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { groupId } = req.params;

        const mediaMessages = await prisma.messages.findMany({
            where: {
                groupId,
                type: { in: ["image", "video", "file"] },
                isDeleted: false,
            },
            orderBy: { createdAt: "desc" },
            take: 12, // جلب آخر 12 ملف ميديا كـ Preview
        });

        return res.status(200).json({ mediaMessages });
    } catch (err) {
        next(err);
    }
};

export const markGroupMessagesAsSeen = async (req, res, next) => {
  try {
    const { userId, groupId } = req.body;
    const prisma = getPrismaInstance();

    // 1. هات كل الرسايل في الجروب ده اللي اليوزر ده لسه مشافهاش
    const messages = await prisma.message.findMany({
      where: {
        groupId,
        senderId: {原型: userId }, // ميسجلش إنه شاف رسايله هو
        seenBy: { none: { userId } }
      },
      select: { id: true, senderId: true }
    });

    // 2. سجل إن اليوزر شافهم
    if (messages.length > 0) {
      await prisma.messageSeen.createMany({
        data: messages.map(msg => ({
          messageId: msg.id,
          userId: userId
        })),
        skipDuplicates: true
      });
    }

    return res.status(200).json({ status: "success" });
  } catch (err) { next(err); }
};

// helper يتحط فوق الدوال مباشرة
const handleDeliveryStatus = async (prisma, message, from, to, groupId) => {
    if (groupId) return; // الجروبات مش محتاجة الـ logic دي

    const sendUserSocket = global.onlineUsers.get(to);
    if (sendUserSocket) {
        await prisma.messages.update({
            where: { id: message.id },
            data: { messageStatus: "delivered" }
        });
        message.messageStatus = "delivered";
        global.io.to(sendUserSocket).emit("msg-send-refresh", { 
            triggered: true, 
            newMessage: { ...message, messageStatus: "delivered" } 
        });
    }

    const senderSocket = global.onlineUsers.get(from);
    if (senderSocket) {
        global.io.to(senderSocket).emit("msg-send-refresh", { 
            triggered: true, 
            newMessage: message 
        });
    }
};