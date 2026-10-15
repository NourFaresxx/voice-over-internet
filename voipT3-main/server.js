const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");

// =====================================================
// 🌐 HTTP SERVER
// =====================================================
const server = http.createServer((req, res) => {

    let filePath = path.join(
        __dirname,
        "public",
        req.url === "/" ? "index.html" : req.url
    );

    let ext = path.extname(filePath);
    let contentType = "text/html";

    if (ext === ".js") contentType = "application/javascript";
    else if (ext === ".css") contentType = "text/css";

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end("Not found");
        }

        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
    });
});

// =====================================================
// 🔌 WEBSOCKET SERVER
// =====================================================
const wss = new WebSocket.Server({ server });

// =====================================================
// 🏠 STATE
// =====================================================
const rooms = new Map();
const clients = new Map();

// =====================================================
// 🛠 HELPERS
// =====================================================
function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function findUser(name) {
    for (const u of clients.values()) {
        if (u.name === name) return u;
    }
    return null;
}

function broadcastRoom(room, data, excludeWs = null) {
    const users = rooms.get(room);
    if (!users) return;

    for (const u of users) {
        if (u.ws !== excludeWs) {
            send(u.ws, data);
        }
    }
}

function sendUserList(room) {
    const users = rooms.get(room);
    if (!users) return;

    const names = [...users].map(u => u.name);

    for (const u of users) {
        send(u.ws, {
            type: "user-list",
            users: names
        });
    }
}

// =====================================================
// 🔗 CONNECTION
// =====================================================
wss.on("connection", (ws) => {

    let user = null;

    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

        // ================= REGISTER =================
        if (data.type === "register") {

            for (const u of clients.values()) {
                if (u.name === data.name) {
                    send(ws, {
                        type: "error",
                        message: "Username already taken"
                    });
                    return;
                }
            }

            user = {
                ws,
                name: data.name,
                room: data.room || "default"
            };

            clients.set(ws, user);

            if (!rooms.has(user.room)) {
                rooms.set(user.room, new Set());
            }

            rooms.get(user.room).add(user);

            console.log(`${user.name} joined ${user.room}`);

            sendUserList(user.room);

            broadcastRoom(user.room, {
                type: "user-joined",
                name: user.name
            }, ws);

            return;
        }

        // ================= OFFER =================
        if (data.type === "offer") {
            const target = findUser(data.target);
            if (!target) return;

            send(target.ws, {
                type: "offer",
                offer: data.offer,
                from: user.name
            });
            return;
        }

        // ================= ANSWER =================
        if (data.type === "answer") {
            const target = findUser(data.target);
            if (!target) return;

            send(target.ws, {
                type: "answer",
                answer: data.answer,
                from: user.name
            });
            return;
        }

        // ================= ICE =================
        if (data.type === "ice-candidate") {
            const target = findUser(data.target);
            if (!target) return;

            send(target.ws, {
                type: "ice-candidate",
                candidate: data.candidate,
                from: user.name
            });
            return;
        }

        // ================= PING =================
        if (data.type === "ping") {
            send(ws, { type: "pong" });
        }
    });

    // ================= DISCONNECT =================
    ws.on("close", () => {

        if (!user) return;

        const room = rooms.get(user.room);

        if (room) {
            room.delete(user);

            if (room.size === 0) {
                rooms.delete(user.room);
            } else {
                sendUserList(user.room);
            }
        }

        clients.delete(ws);

        broadcastRoom(user.room, {
            type: "user-left",
            name: user.name
        });
    });
});

// =====================================================
// 🚀 START
// =====================================================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log("Server running");
});