import getPrismaInstance from "../utils/PrismaClient.js";

export const createGroup = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        // التعديل: استلام members (userId + encryptedKey) بدل users بس
        const { groupName, groupAbout, members, adminId } = req.body;

        if (!groupName || !members || members.length === 0 || !adminId) {
            return res.status(400).send("Group name, members, and admin ID are required.");
        }

        // استخراج الـ IDs من المصفوفة
        const userIds = members.map(m => m.userId);
        const allUserIds = [...new Set([...userIds, adminId])];

        // تنفيذ العملية في Transaction
        const [newGroup] = await prisma.$transaction([
            // 1. إنشاء الجروب
            prisma.group.create({
                data: {
                    name: groupName,
                    about: groupAbout || "Hey there! I am using WhatsApp.",
                    adminIds: [adminId],
                    userIds: allUserIds,
                },
                include: {
                    users: {
                        select: { id: true, name: true, profilePicture: true, email: true }
                    }
                }
            }),
            // 2. إنشاء مفاتيح التشفير لكل الأعضاء (بما فيهم الأدمن لو بعت مفتاحه)
            prisma.groupKey.createMany({
                data: members.map(m => ({
                    groupId: "", // Prisma هتربطها أوتوماتيكياً في الـ Transaction لو استخدمنا connect، بس هنا أسرع نحدثها يدوياً أو نستخدم الـ ID اللي هيرجع
                    userId: m.userId,
                    encryptedKey: m.encryptedKey
                }))
            })
        ]);

        // ملاحظة تقنية: في MongoDB مع Prisma الـ Transaction لـ createMany محتاج الـ groupId
        // فإحنا هنعدل الـ Logic ليكون أكتر استقراراً كالتالي:
        
        const createdGroup = await prisma.group.create({
            data: {
                name: groupName,
                about: groupAbout || "Hey there! I am using WhatsApp.",
                adminIds: [adminId],
                userIds: allUserIds,
            }
        });

        await prisma.groupKey.createMany({
            data: members.map(m => ({
                groupId: createdGroup.id,
                userId: m.userId,
                encryptedKey: m.encryptedKey
            }))
        });

        const finalGroup = await prisma.group.findUnique({
            where: { id: createdGroup.id },
            include: { users: { select: { id: true, name: true, profilePicture: true, email: true } } }
        });

        // إرسال الإشعارات بالسوكيت
        allUserIds.forEach(userId => {
            const userSocket = global.onlineUsers.get(userId);
            if (userSocket) {
                global.io.to(userSocket).emit("group-created", finalGroup);
            }
        });

        return res.status(201).json({ group: finalGroup });
    } catch (err) {
        next(err);
    }
};

export const toggleGroupLock = async (req, res, next) => {
  try {
    const prisma = getPrismaInstance();
    const { groupId } = req.body;

    // 1. تحديث مباشر (أسرع بكتير)
    // بنجيب الجروب الأول عشان نعرف الحالة الحالية
    const currentGroup = await prisma.group.findUnique({
        where: { id: groupId },
        select: { isLocked: true }
    });

    // 2. تحديث الحقل فقط ورجوع الداتا اللي اتغيرت بس
    const updatedGroup = await prisma.group.update({
      where: { id: groupId },
      data: { isLocked: !currentGroup.isLocked },
      select: { id: true, isLocked: true } // مش محتاجين نرجع كل الـ users تاني
    });

    // 3. نبعت "إشارة" صغيرة للسوكيت
    global.io.to(groupId).emit("group-metadata-updated", {
        id: groupId,
        isLocked: updatedGroup.isLocked
    });

    return res.status(200).json({ group: updatedGroup });
  } catch (err) { next(err); }
};

// 2. ترقية/تنزيل رتبة (Admin Only)
export const toggleAdminRole = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { groupId, targetUserId } = req.body;
        const adminId = req.user.id;

        const group = await prisma.group.findUnique({ where: { id: groupId } });
        if (!group.adminIds.includes(adminId)) return res.status(403).send("Admin privilege required.");

        let updatedAdminIds = [...group.adminIds];
        if (updatedAdminIds.includes(targetUserId)) {
            if (updatedAdminIds.length === 1) return res.status(400).send("Group must have at least one admin.");
            updatedAdminIds = updatedAdminIds.filter(id => id !== targetUserId);
        } else {
            updatedAdminIds.push(targetUserId);
        }

        const updatedGroup = await prisma.group.update({
            where: { id: groupId },
            data: { adminIds: updatedAdminIds },
            include: { users: true }
        });

        global.io.to(groupId).emit("group-metadata-updated", updatedGroup);
        return res.status(200).json({ group: updatedGroup });
    } catch (err) { next(err); }
};

// 3. طرد عضو من الجروب (Admin Only)
export const removeMember = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { groupId, targetUserId } = req.body;
        const adminId = req.user.id;

        const group = await prisma.group.findUnique({ where: { id: groupId } });
        if (!group.adminIds.includes(adminId)) return res.status(403).send("Admin privilege required.");
        if (targetUserId === adminId) return res.status(400).send("You cannot remove yourself.");

        const updatedGroup = await prisma.group.update({
            where: { id: groupId },
            data: { 
                userIds: { set: group.userIds.filter(id => id !== targetUserId) },
                adminIds: { set: group.adminIds.filter(id => id !== targetUserId) }
            },
            include: { users: true }
        });

        global.io.to(groupId).emit("group-metadata-updated", updatedGroup);
        return res.status(200).json({ group: updatedGroup });
    } catch (err) { next(err); }
};

export const addGroupMembers = async (req, res, next) => {
  try {
    const prisma = getPrismaInstance();
    // بنستقبل الـ members وهي Array من { userId, encryptedKey }
    const { groupId, members } = req.body; 
    const adminId = req.user.id;

    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group.adminIds.includes(adminId)) return res.status(403).send("Admin privilege required.");

    // 1. استخراج الـ IDs لإضافتهم للجروب
    const newUserIds = members.map(m => m.userId);
    const updatedUserIds = [...new Set([...group.userIds, ...newUserIds])];

    // 2. تحديث الجروب وحفظ مفاتيح الأعضاء الجدد في خطوة واحدة (Transaction)
    const [updatedGroup] = await prisma.$transaction([
      prisma.group.update({
        where: { id: groupId },
        data: { userIds: updatedUserIds },
        include: { users: true }
      }),
      // حفظ المفاتيح المشفرة لكل عضو جديد
      prisma.groupKey.createMany({
        data: members.map(m => ({
          groupId: groupId,
          userId: m.userId,
          encryptedKey: m.encryptedKey
        }))
      })
    ]);

    // 3. إرسال الإشعارات
    global.io.to(groupId).emit("group-metadata-updated", updatedGroup);
    
    newUserIds.forEach(id => {
        global.io.to(id).emit("added-to-group", updatedGroup);
    });

    return res.status(200).json({ group: updatedGroup });
  } catch (err) { next(err); }
};