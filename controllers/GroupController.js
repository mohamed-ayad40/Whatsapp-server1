import getPrismaInstance from "../utils/PrismaClient.js";

export const createGroup = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        // بنستقبل اسم الجروب، والأعضاء اللي هيتضافوا (كمصفوفة من الـ IDs)
        const { groupName, groupAbout, users, adminId } = req.body;

        if (!groupName || !users || users.length === 0 || !adminId) {
            return res.status(400).send("Group name, users, and admin ID are required.");
        }

        // هنضيف الأدمن لمصفوفة الأعضاء عشان يكون جزء من الجروب
        const allUserIds = [...new Set([...users, adminId])];

        // إنشاء الجروب في الداتا بيز
        const newGroup = await prisma.group.create({
            data: {
                name: groupName,
                about: groupAbout || "Hey there! I am using WhatsApp.",
                adminIds: [adminId], // اللي عمل الجروب هو أول أدمن
                userIds: allUserIds, // بنربط الجروب بكل الأعضاء
            },
            include: {
                users: {
                    select: { id: true, name: true, profilePicture: true, email: true }
                }
            }
        });

        // 💡 السحر هنا: نبعت إشعار بالسوكيت لكل الأعضاء إنهم اتضافوا لجروب جديد
        // عشان الجروب يظهر عندهم في القائمة فوراً من غير ريفريش
        allUserIds.forEach(userId => {
            const userSocket = global.onlineUsers.get(userId);
            if (userSocket) {
                global.io.to(userSocket).emit("group-created", newGroup);
            }
        });

        return res.status(201).json({ group: newGroup });
    } catch (err) {
        next(err);
    }
};