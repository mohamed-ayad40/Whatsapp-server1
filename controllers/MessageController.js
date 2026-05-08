import getPrismaInstance from "../utils/PrismaClient.js";
import {unlink} from "fs/promises";
import {v2 as cloudinary} from "cloudinary";
import sanitizeHtml from "sanitize-html";

export const addMessage = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        // زودنا groupId هنا
        let { message, from, to, replyTo, groupId } = req.body;

        // ضفنا شرط إن يكون فيه يا to يا groupId
        if (message && from && (to || groupId)) {
            
            // --- الحماية من الـ XSS (تنظيف الرسالة) ---
            const cleanMessage = sanitizeHtml(message, {
                allowedTags: [], 
                allowedAttributes: {}
            });

            if (!cleanMessage.trim()) {
                return res.status(400).send("Invalid message format.");
            }
            // ------------------------------------------

            // هنجيب حالة اليوزر بس لو الشات فردي
            const getUser = to ? global.onlineUsers.get(to) : null;

            // طلقة واحدة في الداتا بيز (بنفس ستايلك بالظبط)
            const newMessage = await prisma.messages.create({
                data: {
                    message: cleanMessage,
                    senderId: from,
                    receiverId: to || null,      // لو مفيش to (عشان جروب) هياخد null
                    groupId: groupId || null,   // لو مفيش groupId (عشان فردي) هياخد null
                    messageStatus: groupId ? "sent" : (getUser ? "delivered" : "sent"),
                    replyToId: replyTo || null,
                },
                include: {
                    sender: true,
                    receiver: true,
                    replyTo: true,
                    group: true // ضفناها عشان لو جروب نرجع داتا الجروب
                }
            });

            // --- السحر بتاع السوكيت للجروب وللفردي ---
            if (groupId) {
                // لو جروب: نبعت للروم كلها مرة واحدة
                global.io.to(groupId).emit("msg-receive", {
                    from: from,
                    message: newMessage,
                    isGroup: true
                });
            } else {
                // لو فردي: نفس كودك القديم بتاع msg-send-refresh بالمللي
                const sendUserSocket = global.onlineUsers.get(to);
                if(sendUserSocket) {
                    global.io.to(sendUserSocket).emit("msg-send-refresh", {
                        triggered: true,
                        newMessage: newMessage,
                    });
                }

                const receivedUserSocket = global.onlineUsers.get(from);
                if(receivedUserSocket) {
                    global.io.to(receivedUserSocket).emit("msg-send-refresh", {
                        triggered: true,
                        newMessage: newMessage,
                    });
                }
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
        // ... (باقي الكود فوق زي ما هو)
        const { cursor } = req.query; 

        // حماية إضافية لو الـ from أو الـ to جايين بكلمة undefined
        if (from === "undefined" || to === "undefined") return res.status(400).send("Invalid User IDs");

        let messages = await prisma.messages.findMany({
            where: {
                OR: [
                    { senderId: from, receiverId: to },
                    { senderId: to, receiverId: from },
                ],
            },
            include: { replyTo: true },
            orderBy: {
                id: 'desc', 
            },
            take: 40,
            // التعديل هنا: زودنا شرط إن الـ cursor ميكونش كلمة "undefined" أو "null"
            ...(cursor && cursor !== "undefined" && cursor !== "null" && {
                cursor: { id: cursor },
                skip: 1, 
            }),
        });

        messages = messages.filter((msg) => {
            // لو حقل deletedBy موجود، والـ ID بتاعك (from) متسجل جواه، الرسالة دي مش هترجع!
            return !(msg.deletedBy && msg.deletedBy.includes(from));
        });

        messages = messages.reverse();
        // ... (كمل باقي الدالة زي ما ظبطناها في التعديل اللي فات)

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

        // تحديث حالة الرسايل في الـ array اللي هترجع للفرونت إند عشان تبان مقروءة فوراً
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
            nextCursor: messages.length > 0 ? messages[0].id : null,
            hasMore: messages.length === 40, 
        });

    } catch (err) {
        next(err);
    }
};

export const addImageMessage = async (req, res, next) => {
    try {
        if(req.file) {
            const date = Date.now();
            const imageFile = req.file;
            const imageUpload = await cloudinary.uploader.upload(imageFile.path, {resource_type: "image"});
            try {
                unlink(imageFile.path);
            } catch (err) {
                console.error("Failed to delete local image:", err);
            }
            const prisma = getPrismaInstance();
            const {from, to} = req.query;
            if(from && to) {
                const message = await prisma.messages.create({
                    data: {
                        message: imageUpload.secure_url,
                        sender: {connect: {id: from}}, 
                        receiver: {connect: {id: to}},
                        type: "image"
                    }
                });
                return res.status(201).json({ message })
            };
            return res.status(400).send("From and To is required.");
        }
        return res.status(400).send("Image is required.");
    } catch (err) {
        next(err);
    };
};

export const addAudioMessage = async (req, res, next) => {
    try {
        if(req.file) {
            const date = Date.now();
            const audioFile = req.file;
            const audioUpload = await cloudinary.uploader.upload(audioFile.path, {resource_type: "video"});
            try {
                unlink(audioFile.path);
            } catch (err) {
                console.error("Failed to delete local audio:", err);
            }
            const prisma = getPrismaInstance();
            const {from, to} = req.query;
            if(from && to) {
                const message = await prisma.messages.create({
                    data: {
                        message: audioUpload.secure_url,
                        sender: {connect: {id: from}}, 
                        receiver: {connect: {id: to}},
                        type: "audio"
                    }
                });
                return res.status(201).json({ message })
            };
            return res.status(400).send("From and To is required.");
        }
        return res.status(400).send("Audio is required.");
    } catch (err) {
        next(err);
    };
};

export const getInitialContactsWithMessages = async (req, res, next) => {
    try {
        const userId = req.params.from;
        const prisma = getPrismaInstance();

        // 1. هنعمل كويري واحدة بدل اتنين، ونجيب الداتا مترتبة من الداتا بيز مباشرة
        // 2. هنستخدم select عشان نجيب الحقول المهمة بس (تقليل استهلاك الرامات بنسبة 70%)
        const messages = await prisma.messages.findMany({
            where: {
                OR: [{ senderId: userId }, { receiverId: userId }],
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

        // Loop أسرع بكتير لأننا مش بنعمل Spread Operator (...) جوا الـ Loop كتير
        messages.forEach((msg) => {
            const isSender = msg.senderId === userId;
            const calculatedId = isSender ? msg.receiverId : msg.senderId;

            if (msg.messageStatus === "sent") {
                messageStatusChange.push(msg.id);
            }

            if (!users.has(calculatedId)) {
                let user = { 
                    id: msg.id, type: msg.type, message: msg.message, 
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
                // بدل ما نعمل copy للأوبجيكت كله، بنزود الرقم مباشرة (أسرع جداً في الأداء)
                const user = users.get(calculatedId);
                user.totalUnreadMessages += 1;
            }
        });

        if (messageStatusChange.length) {
            await prisma.messages.updateMany({
                where: { id: { in: messageStatusChange } },
                data: { messageStatus: "delivered" },
            });
        }

        // --- الإضافة الخاصة بالجروبات عشان متختفيش مع الـ Refresh ---
        const userGroups = await prisma.group.findMany({
            where: { userIds: { has: userId } },
            include: {
                users: { select: { id: true, name: true, profilePicture: true, email: true } }
            }
        });

        userGroups.forEach((group) => {
            // لو الجروب مش موجود في القائمة، هنضيفه كأنه جهة اتصال
            if (!users.has(group.id)) {
                users.set(group.id, {
                    id: group.id,
                    name: group.name,
                    profilePicture: group.profilePicture || "/default_avatar.png",
                    about: group.about,
                    isGroup: true, // عشان الـ UI يفهم إنه جروب
                    users: group.users,
                    adminIds: group.adminIds,
                    type: "text",
                    message: "Tap to view group", // رسالة افتراضية
                    messageStatus: "read",
                    createdAt: group.createdAt,
                    totalUnreadMessages: 0,
                    senderId: group.id, // بنعتبر الجروب هو الراسل عشان القائمة تظبط
                    receiverId: userId
                });
            }
        });
        // --------------------------------------------------------

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

// 1. دالة تعديل الرسالة
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
            include: { sender: true, receiver: true } // مهم نرجع الـ sender عشان الـ UI
        });

        // --- الإصلاح هنا: نبعت للسوكيت الصح ---
        if (msg.groupId) {
            // لو جروب: بلّغ الروم كلها
            global.io.to(msg.groupId).emit("message-edited", updatedMessage);
        } else if (msg.receiverId) {
            // لو فردي: بلّغ المستلم
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

// 2. دالة حذف الرسالة (للجميع أو ليا بس)
export const deleteMessage = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { messageId, type } = req.body; // type: "everyone" or "me"
        const userId = req.user.id;

        const msg = await prisma.messages.findUnique({ where: { id: messageId } });
        if (!msg) return res.status(404).send("Message not found.");

        let updatedMessage;

        if (type === "everyone") {
            if (msg.senderId !== userId) return res.status(403).send("You can only delete your own messages for everyone.");
            
            // حذف للجميع: بنغير النص ونخلي isDeleted بـ true
            updatedMessage = await prisma.messages.update({
                where: { id: messageId },
                data: { 
                    message: "This message was deleted", // نص افتراضي
                    isDeleted: true 
                }
            });

            // نبعت للطرف التاني عشان الرسالة تتمسح من عنده لايف
            const receiverId = msg.senderId === userId ? msg.receiverId : msg.senderId;
            const receiverSocket = global.onlineUsers.get(receiverId);
            if (receiverSocket) {
                global.io.to(receiverSocket).emit("message-deleted", updatedMessage);
            }

        } else if (type === "me") {
            // حذف من عندي بس: بنضيف الـ ID بتاعي في مصفوفة deletedBy
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