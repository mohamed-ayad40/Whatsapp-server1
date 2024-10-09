import express from "express"
import dotenv from "dotenv";
import cors from "cors";
import AuthRoutes from "./routes/AuthRoutes.js";
import MessageRoute from "./routes/MessageRoutes.js";
import { Server } from "socket.io";
import { getMessages } from "./controllers/MessageController.js";


dotenv.config();
const app = express();

app.use(cors({
    origin: "https://whatsapp-client-delta.vercel.app", // Allow requests from your client
    // credentials: false, // Allow cookies and credentials
    methods: "GET,POST,PUT,DELETE,OPTIONS", // Allow necessary methods
    // preflightContinue: true,
    // allowedHeaders: "Content-Type, Authorization, Accept", // Allow necessary headers
}));
app.use(express.json());
app.use("/uploads/recordings", express.static("uploads/recordings"))
app.use("/uploads/images", express.static("uploads/images"))
app.use("/api/auth", AuthRoutes)
app.use("/api/messages", MessageRoute)
app.get("/", (req, res) => {
    res.send("Hello client");
})
const server = app.listen(120 || process.env.PORT, () => {
    console.log("Server Started on port 4000!");
});

const io = new Server(server, {
    cors: {
        origin: "https://whatsapp-client-delta.vercel.app", // Allow requests from your client
        // credentials: true, // Allow cookies and credentials
        methods: "GET,POST,PUT,DELETE,OPTIONS", // Allow necessary methods
        // preflightContinue: true,
        // allowedHeaders: "Content-Type, Authorization, Accept", // Allow necessary headersrs: "Content-Type, Authorization, Accept", // Allow necessary headers
    },
    transports: ['websocket'],
    path: '/socket.io',
    addTrailingSlash: false,
});


global.onlineUsers = new Map();
global.io = io;
io.on("connection", (socket) => {
    console.log("Connected to socket");
    global.chatSocket = socket;
    socket.on("add-user", (userId) => {
        onlineUsers.set(userId, socket.id);
        console.log(onlineUsers);
        socket.broadcast.emit("online-users", {
            onlineUsers: Array.from(onlineUsers.keys())
        });
    });

    socket.on("join-chat", ({ userId, chatId }) => {
        socket.join(chatId); // Join the chat room
        console.log(`${userId} joined chat ${chatId}`);
    
        // Track the user in the room (optional, for debugging)
        socket.broadcast.to(chatId).emit("user-joined", { userId });
    });

    socket.on("leave-chat", ({ userId, chatId }) => {
        socket.leave(chatId); // Leave the chat room
        console.log(`${userId} left chat ${chatId}`);
        socket.broadcast.to(chatId).emit("user-left", { userId });
    });

    socket.on("msg-seen", (data) => {
        const sendUserSocket = onlineUsers.get(data.to);
        socket.to(sendUserSocket).emit("refresh-seen", {
            to: data.to
        })
    });

    socket.on('disconnect', function(data) {
        for (let [userId, sockId] of onlineUsers.entries()) {
            if (sockId === socket.id) {
                // Remove the user from the map
                onlineUsers.delete(userId);
                break; // Exit the loop once the user is found
            }
        }
        console.log("Online users");
        socket.broadcast.emit("online-users", {
            onlineUsers: Array.from(onlineUsers.keys())
        })
    });

    socket.on("signout", (id) => {
        onlineUsers.delete(id);
        socket.broadcast.emit("online-users", {
            onlineUsers: Array.from(onlineUsers.keys())
        });
    })

    socket.on("trigger-typing", (data) => {
        console.log("Is typing")
        socket.broadcast.emit("receive-typing", {
            from: data.from, //who is writing
            to: data.to,//writing to who
            typing: data.typing
        })
    })

    socket.on("send-msg", (data) => {
        const sendUserSocket = onlineUsers.get(data.to);
        if(sendUserSocket) {
            socket.to(sendUserSocket).emit("msg-receive", {
                from: data.from,
                message: data.message,
            })
        };
    });
    socket.on("outgoing-voice-call", (data) => {
        const sendUserSocket = onlineUsers.get(data.to);
        if(sendUserSocket) {
            socket.to(sendUserSocket).emit("incoming-voice-call", {
                from: data.from,
                roomId: data.roomId,
                callType: data.callType
            });
        };
    });
    socket.on("outgoing-video-call", (data) => {
        const sendUserSocket = onlineUsers.get(data.to);
        if(sendUserSocket) {
            socket.to(sendUserSocket).emit("incoming-video-call", {
                from: data.from,
                roomId: data.roomId,
                callType: data.callType
            });
        };
    });
    socket.on("reject-voice-call", (data) => {
        const sendUserSocket = onlineUsers.get(data.from);
        if (sendUserSocket) {
            console.log("Got reject voice");
            socket.to(sendUserSocket).emit("voice-call-rejected");
        };
    });
    socket.on("reject-video-call", (data) => {
        const sendUserSocket = onlineUsers.get(data.from);
        if (sendUserSocket) {
            console.log("Got reject video");
            socket.to(sendUserSocket).emit("video-call-rejected");
        };
    });
    socket.on("accept-incoming-call", ({id}) => {
        const sendUserSocket = onlineUsers.get(id);
        socket.to(sendUserSocket).emit("accept-call");
    });
    
});
io.engine.on("connection_error", (err) => {
    console.log(err.req);      // the request object
    console.log(err.code);     // the error code, for example 1
    console.log(err.message);  // the error message, for example "Session ID unknown"
    console.log(err.context);  // some additional error context
});
