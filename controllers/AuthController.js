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
            select: { id: true, email: true, name: true, profilePicture: true }, // Select only required fields
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
        const {email, name, about, image: profilePicture} = req.body;
        if(!email || !name || !profilePicture) {
            return res.send("Email, Name and Image are required.");
        };
        const prisma = getPrismaInstance();
        const user = await prisma.user.create({
            data: { email, name, about, profilePicture },
        });
        console.log(user);
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
            select: { id: true, email: true, name: true, profilePicture: true, about: true }, // Only select necessary fields
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
        console.log("User entered");
        const appId = parseInt(process.env.ZEGO_APP_ID);
        const serverSecret = process.env.ZEGO_SERVER_ID;
        const userId = req.params.userId;
        const effectiveTime = process.env.EFFECTIVE_TIME;
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