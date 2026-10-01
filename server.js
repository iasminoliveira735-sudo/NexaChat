const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const clients = new Map();

function makeId() {
  return crypto.randomBytes(5).toString("hex");
}

function cleanText(value, max = 500) {
  return String(value ?? "").replace(/[<>]/g, "").trim().slice(0, max);
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function roomUsers(room) {
  return [...clients.values()]
    .filter(c => c.room === room)
    .map(c => ({ id: c.id, name: c.name }));
}

function broadcastRoom(room, data) {
  for (const c of clients.values()) {
    if (c.room === room) send(c.ws, data);
  }
}

function leave(client) {
  if (!client.room) return;
  const oldRoom = client.room;
  client.room = null;
  const users = roomUsers(oldRoom);
  broadcastRoom(oldRoom, { type: "users", users });
}

wss.on("connection", ws => {
  const client = {
    ws,
    id: makeId(),
    name: "Visitante",
    room: null
  };
  clients.set(client.id, client);

  send(ws, { type: "connected", id: client.id });

  ws.on("message", raw => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: "error", message: "Mensagem inválida." });
    }

    if (data.type === "join") {
      const name = cleanText(data.name, 24) || "Visitante";
      const room = cleanText(data.room, 32).toUpperCase();

      if (!room) return send(ws, { type: "error", message: "Digite o código da sala." });

      leave(client);
      client.name = name;
      client.room = room;

      if (!rooms.has(room)) rooms.set(room, { createdAt: Date.now() });

      send(ws, {
        type: "joined",
        room,
        me: { id: client.id, name: client.name },
        users: roomUsers(room)
      });

      broadcastRoom(room, {
        type: "users",
        users: roomUsers(room)
      });

      broadcastRoom(room, {
        type: "system",
        message: `${client.name} entrou na sala.`
      });
      return;
    }

    if (data.type === "message") {
      if (!client.room) return;
      const message = cleanText(data.message, 1000);
      if (!message) return;

      broadcastRoom(client.room, {
        type: "message",
        id: makeId(),
        from: client.name,
        senderId: client.id,
        message,
        time: new Date().toISOString()
      });
      return;
    }

    if (data.type === "leave") {
      const room = client.room;
      leave(client);
      if (room) broadcastRoom(room, {
        type: "system",
        message: `${client.name} saiu da sala.`
      });
      return;
    }
  });

  ws.on("close", () => {
    const room = client.room;
    const name = client.name;
    leave(client);
    clients.delete(client.id);
    if (room) {
      broadcastRoom(room, {
        type: "system",
        message: `${name} saiu da sala.`
      });
    }
  });
});

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    app: "NexaChat",
    online: clients.size,
    rooms: rooms.size
  });
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`NexaChat rodando na porta ${PORT}`);
});
