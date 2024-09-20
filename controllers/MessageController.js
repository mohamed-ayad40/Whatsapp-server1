import getPrismaInstance from "../utils/PrismaClient.js";
import {renameSync} from "fs";
import {v2 as cloudinary} from "cloudinary";

// export const addMessage = async (req, res, next) => {
//     try {
//         const prisma = getPrismaInstance();
//         const { message, from, to } = req.body;
//         const getUser = onlineUsers.get(to);
//         if(message && from && to) {
//             const newMessage = await prisma.messages.create({
//                 data: {
//                     message,
//                     senderId: from, // Only storing the senderId here
//                     receiverId: to, // Only storing the receiverId here
//                     messageStatus: getUser ? "delivered" : "sent",
//                 },
//             });

//             // Fetch sender and receiver details separately
//             const [sender, receiver] = await Promise.all([
//                 prisma.user.findUnique({ where: { id: from } }),
//                 prisma.user.findUnique({ where: { id: to } }),
//             ]);


//             // Manually attach the sender and receiver to newMessage
//             newMessage.sender = sender;
//             newMessage.receiver = receiver;
//             const sendUserSocket = global.onlineUsers.get(to);
//             console.log(sendUserSocket)
//             global.io.
//             global.io.to(sendUserSocket).emit("msg-send-refresh", {
//                 triggered: true,
//             });
//             return res.status(201).json({
//                 message: newMessage
//             });
//         }
//         return res.status(400).send("From, To and Message are required.")
//     } catch (err) {
//         next(err);
//     };
// };

export const addMessage = async (req, res, next) => {
    try {
    const prisma = getPrismaInstance();
    const { message, from, to, chatId } = req.body;

    if (message && from && to) {
        const getUser = global.onlineUsers.get(to);

        // Save the new message with default status
        const newMessage = await prisma.messages.create({
        data: {
            message,
            senderId: from,
            receiverId: to,
            messageStatus: getUser ? "delivered" : "sent",
        },
        });

        // Fetch sender and receiver details
        const [sender, receiver] = await Promise.all([
        prisma.user.findUnique({ where: { id: from } }),
        prisma.user.findUnique({ where: { id: to } }),
        ]);

        newMessage.sender = sender;
        newMessage.receiver = receiver;

        // Check if both users are in the same chat room
        const roomClients = global.io.sockets.adapter.rooms.get(chatId);
        const isBothInChat = roomClients && roomClients.size === 2;

        // If both users are in the chat, mark message as "read"
        if (isBothInChat) {
        newMessage.messageStatus = "read";
        await prisma.messages.update({
            where: { id: newMessage.id },
            data: { messageStatus: "read" },
        });

        // Emit an event to both users that the message was read
        global.io.to(chatId).emit("message-read", {
            messageId: newMessage.id,
            status: "read",
        });
        }

        const sendUserSocket = global.onlineUsers.get(to);
        global.io.to(sendUserSocket).emit("msg-send-refresh", {
            triggered: true,
            newMessage: newMessage,
        });
        const receivedUserSocket = global.onlineUsers.get(from);
        global.io.to(receivedUserSocket).emit("msg-send-refresh", {
            triggered: true,
            newMessage: newMessage,
        });

        // Emit the event to refresh messages for both users
        // global.io.to(chatId).emit("msg-send-refresh", {
        // triggered: true,
        // newMessage: newMessage,
        // });

        return res.status(201).json({ message: newMessage });
    }

    return res.status(400).send("From, To, and Message are required.");
    } catch (err) {
    next(err);
    }
};

export const getMessages = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { from, to } = req.params || req.body;

        // 1. Fetch messages and mark unread ones in one query
        const messages = await prisma.messages.findMany({
            where: {
                OR: [
                    {
                        senderId: from,
                        receiverId: to,
                    },
                    {
                        senderId: to,
                        receiverId: from,
                    },
                ],
            },
            orderBy: {
                id: 'asc',
            },
        });

        // 2. Collect unread message IDs for batch update
        const unreadMessageIds = messages
            .filter((message) => message.messageStatus !== 'read' && message.senderId === to)
            .map((message) => message.id);

        // 3. Batch update all unread messages to 'read' if there are any
        if (unreadMessageIds.length > 0) {
            await prisma.messages.updateMany({
                where: {
                    id: { in: unreadMessageIds },
                },
                data: {
                    messageStatus: 'read',
                },
            });

            // Update the status of those unread messages in the messages array
            messages.forEach((message) => {
                if (unreadMessageIds.includes(message.id)) {
                    message.messageStatus = 'read';
                }
            });
        }
        const sendUserSocket = global.onlineUsers.get(to);
        console.log(sendUserSocket)
        console.log("AFFFF")
        global.io.emit("refresh-seen", {
            from
        });
        // 4. Return the messages in the response
        res.status(200).json({
            messages,
        });
    } catch (err) {
        next(err);
    }
};


export const addImageMessage = async (req, res, next) => {
    try {
        if(req.file) {
            const date = Date.now();
            console.log(date);
            console.log(req.file.path);
            const imageFile = req.file;
            const imageUpload = await cloudinary.uploader.upload(imageFile.path, {resource_type: "image"});
            // let fileName = "uploads/images/" + date + req.file.originalname;
            // console.log(fileName);
            // renameSync(req.file.path, fileName);
            const prisma = getPrismaInstance();
            const {from, to} = req.query;
            if(from && to) {
                const message = await prisma.messages.create({
                    data: {
                        message: imageUpload.secure_url,
                        sender: {connect: {id: from}}, /// or remove the parseInt
                        receiver: {connect: {id: to}},
                        type: "image"
                    }
                });
                return res.status(201).json({
                    message
                })
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
            // console.log(date);
            // console.log(req.file.path);
            // let fileName = "uploads/recordings/" + date + req.file.originalname;
            // console.log(fileName);
            // renameSync(req.file.path, fileName);
            const audioFile = req.file;
            const audioUpload = await cloudinary.uploader.upload(audioFile.path, {resource_type: "video"});
            const prisma = getPrismaInstance();
            const {from, to} = req.query;
            if(from && to) {
                const message = await prisma.messages.create({
                    data: {
                        message: audioUpload.secure_url,
                        sender: {connect: {id: from}}, /// or remove the parseInt
                        receiver: {connect: {id: to}},
                        type: "audio"
                    }
                });
                return res.status(201).json({
                    message
                })
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

        // 1. Fetch messages separately for sent and received to reduce query complexity
        const [sentMessages, receivedMessages] = await Promise.all([
            prisma.messages.findMany({
                where: { senderId: userId },
                include: {
                    receiver: true,
                    sender: true,
                },
                orderBy: { createdAt: "desc" },
            }),
            prisma.messages.findMany({
                where: { receiverId: userId },
                include: {
                    receiver: true,
                    sender: true,
                },
                orderBy: { createdAt: "desc" },
            }),
        ]);

        // 2. Combine sent and received messages and sort by createdAt
        const messages = [...sentMessages, ...receivedMessages].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        );

        const users = new Map();
        const messageStatusChange = [];

        // 3. Process each message to construct the user map and manage unread messages
        messages.forEach((msg) => {
            const isSender = msg.senderId === userId;
            const calculatedId = isSender ? msg.receiverId : msg.senderId;

            // Mark as delivered if still in 'sent' status
            if (msg.messageStatus === "sent") {
                messageStatusChange.push(msg.id);
            }

            if (!users.get(calculatedId)) {
                const { id, type, message, messageStatus, createdAt, senderId, receiverId } = msg;

                let user = { id, type, message, messageStatus, createdAt, senderId, receiverId };

                if (isSender) {
                    user = {
                        ...user,
                        ...msg.receiver,
                        totalUnreadMessages: 0,
                    };
                } else {
                    user = {
                        ...user,
                        ...msg.sender,
                        totalUnreadMessages: messageStatus !== "read" ? 1 : 0,
                    };
                }

                users.set(calculatedId, { ...user });
            } else if (msg.messageStatus !== "read" && !isSender) {
                const user = users.get(calculatedId);
                users.set(calculatedId, {
                    ...user,
                    totalUnreadMessages: user.totalUnreadMessages + 1,
                });
            }
        });

        // 4. Update message statuses in bulk for all 'sent' messages to 'delivered'
        if (messageStatusChange.length) {
            await prisma.messages.updateMany({
                where: { id: { in: messageStatusChange } },
                data: { messageStatus: "delivered" },
            });
        }

        // 5. Return the results with the user list and online users
        return res.status(200).json({
            users: Array.from(users.values()),
            onlineUsers: Array.from(onlineUsers.keys()),
        });
    } catch (err) {
        next(err);
    }
};


export const updateMessageStatusAndUnreadCount = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { from, to } = req.body;

        // 1. Update the messageStatus of unread messages from 'sent' or 'delivered' to 'read'
        await prisma.messages.updateMany({
            where: {
            senderId: to,  // Sender of the unread messages
            receiverId: from,  // Receiver (current user) reading the messages
            messageStatus: { in: ["sent", "delivered"] },
            },
            data: {
            messageStatus: "read",
            },
        });

        // 2. Count the remaining unread messages for the user (if you still want to display unread count)
        const unreadCount = await prisma.messages.count({
            where: {
            receiverId: from,  // The current user receiving the messages
            messageStatus: { not: "read" },  // Messages that are not read yet
            },
        });

    // You can use the unreadCount variable if you need to show the total unread messages.
        return res.status(200).json({
            message: "Status and unread messages updated successfully",
            unreadCount,  // Optionally return this if needed
        });
    } catch (err) {
        next(err);
    }
};
