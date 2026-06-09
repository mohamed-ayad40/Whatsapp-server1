import getPrismaInstance from "../utils/PrismaClient.js";
import {generateToken04} from "../utils/TokenGenerator.js";

export const checkUser = async (req, res, next) => {
  try {
    const { email, phoneNumber } = req.body;
    if (!email && !phoneNumber) {
      return res.json({ message: "Email or phone number is required.", status: false });
    }

    const prisma = getPrismaInstance();
    const user = await prisma.user.findFirst({
      where: email ? { email } : { phoneNumber },
      // 🚨 التعديل: ضفنا ecdhPublicKey في الـ select عشان يرجع للفرونت إند
      select: { id: true, email: true, phoneNumber: true, name: true, profilePicture: true, about: true, publicKey: true, ecdhPublicKey: true },
    });

    if (!user) return res.json({ message: "User not found!", status: false });
    return res.json({ message: "User found", status: true, data: user });
  } catch (err) {
    next(err);
  }
};

export const onBoardUser = async (req, res, next) => {
  try {
    // 🚨 التعديل: بنستقبل ecdhPublicKey من الـ req.body
    const { email, phoneNumber, name, about, image: profilePicture, publicKey, ecdhPublicKey } = req.body;

    if ((!email && !phoneNumber) || !name || !profilePicture) {
      return res.send("Name, Image, and (Email or Phone) are required.");
    }

    const prisma = getPrismaInstance();
    const user = await prisma.user.create({
      data: {
        ...(email && { email }),
        ...(phoneNumber && { phoneNumber }),
        name,
        about,
        profilePicture,
        publicKey, // مفتاح الجروبات
        ecdhPublicKey, // مفتاح الشات الفردي
      },
    });

    return res.json({ message: "Success", status: true, user });
  } catch (err) {
    next(err);
  }
};

export const getAllUsers = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();

        const users = await prisma.user.findMany({
            orderBy: { name: "asc" },
            // 🚨 التعديل: ضفنا ecdhPublicKey عشان لما تجيب الكونتاكت تلاقي مفتاحه
            select: { id: true, email: true, name: true, profilePicture: true, about: true, publicKey: true, ecdhPublicKey: true },
        });

        const usersGroupedByInitialLetter = users.reduce((acc, user) => {
            const initialLetter = user.name.charAt(0).toUpperCase();
            if (!acc[initialLetter]) acc[initialLetter] = [];
            acc[initialLetter].push(user);
            return acc;
        }, {});

        return res.status(200).json({ users: usersGroupedByInitialLetter });
    } catch (err) {
        next(err);
    }
};

export const generateToken = async (req, res, next) => {
    try {
        const appId = parseInt(process.env.ZEGO_APP_ID);
        const serverSecret = process.env.ZEGO_SERVER_ID;
        const userId = req.params.userId;
        const effectiveTime = parseInt(process.env.EFFECTIVE_TIME) || 3600;
        const payload = "";
        
        if(appId && serverSecret && userId) {
            const token = await generateToken04(appId, userId, serverSecret, effectiveTime, payload);
            return res.status(200).json({
                token
            });
        }
        return res.status(400).send("User id, app id and server secret is required.");
    } catch (err) {
        next(err);
    };
};
export const updateUserInfo = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();
        const { id, name, about, profilePicture } = req.body;

        if (!id || !name) {
            return res.status(400).send("Name and ID are required.");
        }

        const updatedUser = await prisma.user.update({
            where: { id },
            data: { 
                name, 
                about, // الـ About هيوصل هنا طلاسم (متشفر) من الفرونت إند
                profilePicture 
            },
        });

        return res.status(200).json({
            message: "Profile updated successfully.",
            status: true,
            user: updatedUser
        });
    } catch (err) {
        next(err);
    }
};
export const toggleBlockUser = async (req, res, next) => {
    try {
        const { userId, targetId } = req.body;
        const prisma = getPrismaInstance();

        // 1. تشييك سريع: هل هو متسجل في لستة البلوك الحالية؟
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { blockedUsers: true }
        });

        const isAlreadyBlocked = user.blockedUsers.includes(targetId);

        if (isAlreadyBlocked) {
            // فك البلوك بـ طلقة O(1) باستخدام أوامر الداتا بيز مباشرة
            await prisma.user.update({
                where: { id: userId },
                data: { blockedUsers: { pull: targetId } } // 👈 طير التارجت من لستتي
            });
            await prisma.user.update({
                where: { id: targetId },
                data: { blockedBy: { pull: userId } } // 👈 طيرني من لستة الـ blockedBy بتاعته
            });
        } else {
            // عمل بلوك
            await prisma.user.update({
                where: { id: userId },
                data: { blockedUsers: { push: targetId } } // 👈 ضيف التارجت للستتي
            });
            await prisma.user.update({
                where: { id: targetId },
                data: { blockedBy: { push: userId } } // 👈 ضيفني للستة بتاعته
            });
        }

        // نجيب اللستة المحدثة عشان نرجعها للفرونت إند يطرد الشات فوراً
        const updatedUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { blockedUsers: true }
        });

        return res.status(200).json({ 
            status: true, 
            message: isAlreadyBlocked ? "User unblocked" : "User blocked",
            blockedUsers: updatedUser.blockedUsers
        });

    } catch (err) { next(err); }
};

export const updateUser = async (req, res, next) => {
    try {
        const { id, name, about, profilePicture } = req.body;
        const prisma = getPrismaInstance();

        const updatedUser = await prisma.user.update({
            where: { id: id },
            data: {
                name,
                about,
                profilePicture,
            }
        });

        return res.status(200).json({ status: true, user: updatedUser });
    } catch (err) {
        next(err);
    }
};
export const updatePublicKey = async (req, res, next) => {
    try {
        // 🚨 التعديل: بنستقبل ecdhPublicKey مع الـ publicKey
        const { id, publicKey, ecdhPublicKey } = req.body;
        const prisma = getPrismaInstance();
        
        const updatedUser = await prisma.user.update({
            where: { id },
            data: { 
                publicKey: publicKey,
                ecdhPublicKey: ecdhPublicKey 
            }
        });
        
        return res.status(200).json({ status: true, user: updatedUser });
    } catch (err) { next(err); }
};