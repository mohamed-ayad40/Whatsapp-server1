import getPrismaInstance from "../utils/PrismaClient.js";
import {generateToken04} from "../utils/TokenGenerator.js";

export const checkUser = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.json({
                message: "Email is required.",
                status: false
            });
        }

        const prisma = getPrismaInstance();
        const user = await prisma.user.findUnique({
            where: { email },
            // ضفنا الـ publicKey هنا عشان الـ Context في الفرونت يحفظه
            select: { id: true, email: true, name: true, profilePicture: true, about: true, publicKey: true }, 
        });

        if (!user) {
            return res.json({
                message: "User not found!",
                status: false
            });
        }

        return res.json({
            message: "User found",
            status: true,
            data: user
        });

    } catch (err) {
        next(err);
    }
};

export const onBoardUser = async (req, res, next) => {
    try {
        // استلام الـ publicKey من الـ Request Body
        const {email, name, about, image: profilePicture, publicKey} = req.body;
        
        if(!email || !name || !profilePicture) {
            return res.send("Email, Name and Image are required.");
        };

        const prisma = getPrismaInstance();
        const user = await prisma.user.create({
            // تخزين الـ publicKey في الداتا بيز لأول مرة
            data: { email, name, about, profilePicture, publicKey },
        });

        console.log("New User Created with Public Key:", user.id);
        return res.json({message: "Success", status: true, user});
    } catch(err) {
        next(err);
    };
};

export const getAllUsers = async (req, res, next) => {
    try {
        const prisma = getPrismaInstance();

        const users = await prisma.user.findMany({
            orderBy: { name: "asc" },
            // مهم جداً نبعت الـ publicKey في لستة الـ Contacts 
            // عشان لما تحب تبدأ شات متشفر مع حد، تلاقي مفتاحه جاهز
            select: { id: true, email: true, name: true, profilePicture: true, about: true, publicKey: true },
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