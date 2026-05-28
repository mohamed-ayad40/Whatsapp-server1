import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
dotenv.config();

const prisma = new PrismaClient();

async function fixIndex() {
    try {
        await prisma.$runCommandRaw({
            createIndexes: "User",
            indexes: [{
                key: { phoneNumber: 1 },
                name: "User_phoneNumber_key",
                unique: true,
                sparse: true
            }]
        });
        console.log("Sparse index created");
    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

fixIndex();