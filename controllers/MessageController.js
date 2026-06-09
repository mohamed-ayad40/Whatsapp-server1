import getPrismaInstance from "../utils/PrismaClient.js";
import {unlink} from "fs/promises";
import {v2 as cloudinary} from "cloudinary";
import sanitizeHtml from "sanitize-html";

export const addMessage = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        let { message, from, to, replyTo, groupId } = req.body;

        if (message && from && (to || groupId)) {
            
            const cleanMessage = sanitizeHtml(message, { allowedTags: [], allowedAttributes: {} });

            if (!cleanMessage.trim()) return res.status(400).send("Invalid message format.");

            if (!groupId && to) {
                const receiver = await prisma.user.findUnique({
                    where: { id: to },
                    select: { blockedUsers: true }
                });
                if (receiver?.blockedUsers?.includes(from)) {
                    return res.status(403).json({ message: "You are blocked by this user." });
                }
            }

            const newMessage = await prisma.messages.create({
                data: {
                    message: cleanMessage,
                    senderId: from,
                    receiverId: to || null,
                    groupId: groupId || null,
                    messageStatus: "sent", 
                    replyToId: replyTo || null,
                },
                include: { sender: true, receiver: true, replyTo: true, group: true }
            });

            if (groupId) {
                global.io.to(groupId).emit("msg-receive", { from, message: newMessage, isGroup: true });
                // 🚨 التعديل السحري: إرسال الـ trigger اللي بيحرك العداد برة في القائمة لكل الأعضاء!
                global.io.to(groupId).emit("msg-send-refresh", { triggered: true, newMessage });
            } else {
                await handleDeliveryStatus(prisma, newMessage, from, to, groupId); 
            }

            return res.status(201).json({ message: newMessage });
        }
        return res.status(400).send("Message, From, and (To or GroupId) are required.");
    } catch (err) { next(err); }
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
            try { unlink(imageFile.path); } catch (err) {}
            
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
                        messageStatus: "sent", 
                    }
                });

                if (groupId) {
                    global.io.to(groupId).emit("msg-receive", { from, message, isGroup: true });
                    // 🚨 التعديل للصور: السايدبار يتحدث ويظهر إن فيه صورة اتبعتت
                    global.io.to(groupId).emit("msg-send-refresh", { triggered: true, newMessage: message });
                } else {
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
            try { unlink(audioFile.path); } catch (err) {}
            
            const prisma = getPrismaInstance();
            const {from, to, groupId} = req.query;

            let waveformData = [];
            if (req.body.waveform) {
                try { waveformData = JSON.parse(req.body.waveform); } catch (e) {}
            }

            if(from && (to || groupId)) {
                const message = await prisma.messages.create({
                    data: {
                        message: audioUpload.secure_url,
                        waveform: waveformData, 
                        sender: {connect: {id: from}}, 
                        ...(to && to !== "undefined" && { receiver: {connect: {id: to}} }),
                        ...(groupId && groupId !== "undefined" && { group: {connect: {id: groupId}} }),
                        type: "audio",
                        messageStatus: "sent", 
                    }
                });

                if (groupId) {
                    global.io.to(groupId).emit("msg-receive", { from, message, isGroup: true });
                    // 🚨 التعديل للفويسات: السايدبار يتحدث
                    global.io.to(groupId).emit("msg-send-refresh", { triggered: true, newMessage: message });
                } else {
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

        // 1. جلب الرسائل الفردية
        // ⚠️ نصيحة للمستقبل: لو الرسايل كترت جداً (ملايين)، الـ Query دي هتحتاج Optimization
        // لأنها بتجيب كل الرسايل. لكن حالياً هتمشي معاك تمام.
        const messages = await prisma.messages.findMany({
            where: {
                OR: [{ senderId: userId }, { receiverId: userId }], 
                groupId: null, // رسائل فردية فقط
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true, type: true, message: true, messageStatus: true, createdAt: true,
                senderId: true, receiverId: true,
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

        if (messageStatusChange.length) {
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
                // مش محتاجين await هنا عشان منأخرش الرد على الفرونت إند (تحديث في الخلفية)
                prisma.messages.updateMany({
                    where: { id: { in: onlineMessageIds } },
                    data: { messageStatus: "delivered" },
                }).catch(err => console.log("Background status update error:", err));
            }
        }

        // 2. جلب الجروبات
        const userGroups = await prisma.group.findMany({
            where: { userIds: { has: userId } },
            include: {
                users: { select: { id: true, name: true, profilePicture: true, email: true } },
                encryptedKeys: {
                    where: { userId: userId },
                    select: { encryptedKey: true }
                }
            }
        });

        // 🚨 التعديل السحري الأول: إطلاق كل استعلامات الجروبات في نفس اللحظة (Parallel Execution)
        await Promise.all(userGroups.map(async (group) => {
            if (!users.has(group.id)) {
                
                // 🚨 التعديل السحري التاني: جلب آخر رسالة والعداد في نفس اللحظة برضه!
                const [lastMessage, unreadCount] = await Promise.all([
                    prisma.messages.findFirst({
                        where: { groupId: group.id },
                        orderBy: { createdAt: "desc" },
                        include: { _count: { select: { seenBy: true } } }
                    }),
                    prisma.messages.count({
                        where: {
                            groupId: group.id,
                            senderId: { not: userId },
                            seenBy: { none: { userId: userId } }
                        }
                    })
                ]);

                users.set(group.id, {
                    id: group.id,
                    name: group.name,
                    profilePicture: group.profilePicture || "/default_avatar.png",
                    about: group.about,
                    isGroup: true,
                    isLocked: group.isLocked,
                    users: group.users,
                    userIds: group.userIds, 
                    adminIds: group.adminIds,
                    
                    type: lastMessage ? lastMessage.type : "text",
                    message: lastMessage ? lastMessage.message : "Tap to view group",
                    messageStatus: lastMessage ? lastMessage.messageStatus : "read",
                    createdAt: lastMessage ? lastMessage.createdAt : group.createdAt,
                    senderId: lastMessage ? lastMessage.senderId : group.id,
                    
                    totalUnreadMessages: unreadCount,
                    receiverId: userId,
                    encryptedKey: group.encryptedKeys[0]?.encryptedKey || null,
                    seenCount: lastMessage?._count?.seenBy || 0,
                });
            }
        }));

        // 🚨 خطوة أخيرة: ترتيب كل الـ Contacts (فردي وجروبات) بناءً على أحدث رسالة قبل ما نبعتهم
        const sortedUsers = Array.from(users.values()).sort((a, b) => {
            return new Date(b.createdAt) - new Date(a.createdAt);
        });

        return res.status(200).json({
            users: sortedUsers,
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
    const messages = await prisma.messages.findMany({
      where: {
        groupId,
        senderId: {not: userId }, // ميسجلش إنه شاف رسايله هو
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

export const deleteChat = async (req, res, next) => {
    try {
        const { userId, chatId } = req.body;
        const prisma = getPrismaInstance();

        // 🚨 مسح كل الرسايل المتبادلة بين الشخصين دول نهائياً
        await prisma.messages.deleteMany({
            where: {
                OR: [
                    { senderId: userId, receiverId: chatId },
                    { senderId: chatId, receiverId: userId }
                ]
            }
        });

        return res.status(200).json({ status: true, message: "Chat deleted successfully." });
    } catch (err) {
        next(err);
    }
};

// --- الدالة الجديدة لجلب ميديا الشات الفردي ---
// --- الدالة الجديدة لجلب ميديا الشات الفردي (محدثة) ---
export const getUserMedia = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { from, to } = req.params;

        const all = await prisma.messages.findMany({
            where: {
                OR: [
                    { senderId: from, receiverId: to },
                    { senderId: to, receiverId: from }
                ],
                type: "image",
            },
        });

        all.forEach(m => console.log("MSG:", m.message.substring(0, 50), "| groupId:", m.groupId));

        return res.status(200).json({ mediaMessages: all });
    } catch (err) {
        next(err);
    }
};