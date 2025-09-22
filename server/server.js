// server/server.js
// Lakdi realtime server (Express + Socket.IO)
// Serves client/ statics and hosts game rooms with bot support.

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { LakdiGame } = require("./gameLogic");
const { makeBot } = require("./botLogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }, // For MVP; restrict in prod
});

const PORT = process.env.PORT || 3000;

// Serve static client
app.use(express.static(path.join(__dirname, "..", "client")));

// Health
app.get("/health", (_req, res) => res.status(200).send("ok"));

// Rooms (roomId -> { game, bots: Map(botId->bot) })
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { game: new LakdiGame(roomId), bots: new Map() });
  }
  return rooms.get(roomId);
}

function broadcast(room) {
  const base = room.game.getPublicState();
  for (const p of room.game.players) {
    const payload = structuredClone(base);
    payload.you = {
      id: p.id,
      name: p.name,
      hand: room.game.getPrivateHand(p.id),
    };
    io.to(p.id).emit("state", { state: payload });
  }
}

function maybeTickBots(room) {
  // If it's a bot's turn and game not declared, ask bot to move.
  const activeId = room.game.players[room.game.activeIdx]?.id;
  const bot = room.bots.get(activeId);
  if (!bot || room.game.declared || !room.game.started) return;

  // Slight delay to feel natural
  setTimeout(() => {
    try {
      bot.takeTurn(room.game, (event, payload) => {
        // Mirror socket API that human clients use
        if (event === "discard") room.game.discard(bot.id, payload.handIndices);
        if (event === "draw") room.game.draw(bot.id, payload.source);
        if (event === "lakdi") room.game.callLakdi(bot.id);
        broadcast(room);
        // If still bot's turn (rare), chain again
        maybeTickBots(room);
      });
    } catch (e) {
      console.error("Bot error:", e);
    }
  }, 650);
}

io.on("connection", (socket) => {
  socket.on("join", ({ roomId, name }) => {
    const room = getOrCreateRoom(roomId);
    socket.join(roomId);
    socket.join(socket.id);
    const res = room.game.addPlayer(socket.id, name);
    if (!res.ok) return io.to(socket.id).emit("error", res.err);
    io.to(socket.id).emit("joined", { roomId, playerId: socket.id, host: room.game.hostId === socket.id });
    broadcast(room);
  });

  socket.on("start", ({ roomId, handSize, turnSeconds }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.game.hostId !== socket.id) return;
    if (handSize) room.game.handSize = Math.max(1, Math.min(7, handSize));
    if (turnSeconds) room.game.turnSeconds = Math.max(5, Math.min(90, turnSeconds));
    const res = room.game.start(() => {
      // timer expired callback (auto-move already applied in game)
      broadcast(room);
      maybeTickBots(room);
    });
    if (!res.ok) io.to(socket.id).emit("error", res.err);
    else {
      broadcast(room);
      maybeTickBots(room);
    }
  });

  socket.on("discard", ({ roomId, handIndices }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.game.discard(socket.id, handIndices || []);
    if (!res.ok) io.to(socket.id).emit("error", res.err);
    else broadcast(room);
  });

  socket.on("draw", ({ roomId, source }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.game.draw(socket.id, source);
    if (!res.ok) io.to(socket.id).emit("error", res.err);
    else {
      broadcast(room);
      maybeTickBots(room);
    }
  });

  socket.on("lakdi", ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const res = room.game.callLakdi(socket.id);
    if (!res.ok) io.to(socket.id).emit("error", res.err);
    else broadcast(room);
  });

  // Admin/host-only: add a bot (easy|medium|hard)
  socket.on("addBot", ({ roomId, difficulty = "easy", name }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.game.hostId !== socket.id) return;
    const botId = `bot-${Math.random().toString(36).slice(2, 8)}`;
    const botName = name || `${difficulty[0].toUpperCase()}${difficulty.slice(1)}Bot`;
    const res = room.game.addPlayer(botId, botName, /*connected*/ false);
    if (!res.ok) return io.to(socket.id).emit("error", res.err);
    const bot = makeBot(botId, difficulty);
    room.bots.set(botId, bot);
    broadcast(room);
    maybeTickBots(room);
  });

  socket.on("disconnect", () => {
    for (const [, room] of rooms) {
      const p = room.game.players.find(pl => pl.id === socket.id);
      if (p) {
        room.game.markDisconnected(socket.id);
        broadcast(room);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Lakdi server listening on :${PORT}`);
});
