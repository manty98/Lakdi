// server/server.js
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

// === Serve static files from client/ ===
app.use(express.static(path.join(__dirname, "..", "client")));
app.get("/health", (req, res) => res.send("ok"));

// === Game State ===
const rooms = {}; // roomId -> { players:[], hostId, started, deck, hands, discard, pastDiscard, activePlayerId, declared }

function makeDeck() {
  const suits = ["♠","♥","♦","♣"];
  const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push({ r, s });
  for (let i=deck.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}
function nextTurn(room) {
  if (!room.activePlayerId) {
    room.activePlayerId = room.players[0].id;
    return;
  }
  const idx = room.players.findIndex(p => p.id === room.activePlayerId);
  const next = room.players[(idx+1)%room.players.length];
  room.activePlayerId = next.id;
}

function broadcast(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  room.players.forEach(p => {
    const pub = {
      players: room.players.map(pl => ({
        id: pl.id,
        name: pl.name,
        handCount: room.hands[pl.id]?.length || 0,
      })),
      hostId: room.hostId,
      started: room.started,
      activePlayerId: room.activePlayerId,
      stockCount: room.deck.length,
      pastDiscard: room.pastDiscard || [],
      immediateDiscard: room.discard || [],
      declared: room.declared || false,
    };
    io.to(p.id).emit("state", {
      state: { ...pub, you: { id:p.id, name:p.name, hand: room.hands[p.id]||[] } },
    });
  });
}

// === Socket.IO handlers ===
io.on("connection", (socket) => {
  console.log("[connect]", socket.id);

  socket.on("join", ({ roomId, name }) => {
    if (!roomId) return;
    if (!rooms[roomId]) {
      rooms[roomId] = {
        players: [],
        hostId: socket.id,
        started: false,
        deck: [],
        hands: {},
        discard: [],
        pastDiscard: [],
      };
    }
    const room = rooms[roomId];
    if (!room.players.find(p => p.id === socket.id)) {
      room.players.push({ id: socket.id, name: name||"Player" });
    }
    socket.join(roomId);
    socket.join(socket.id); // so we can emit private hand
    socket.emit("joined", { roomId, host: room.hostId===socket.id });
    broadcast(roomId);
  });

  socket.on("start", ({ roomId, handSize }) => {
    const room = rooms[roomId];
    if (!room || room.hostId!==socket.id) return;
    room.deck = makeDeck();
    room.hands = {};
    for (const p of room.players) {
      room.hands[p.id] = room.deck.splice(0, handSize||5);
    }
    room.started = true;
    room.discard = [];
    room.pastDiscard = [];
    room.declared = false;
    nextTurn(room);
    broadcast(roomId);
  });

  socket.on("discard", ({ roomId, handIndices }) => {
    const room = rooms[roomId]; if (!room) return;
    if (room.activePlayerId!==socket.id) return;
    const hand = room.hands[socket.id]; if (!hand) return;
    const cards = handIndices.map(i => hand[i]).filter(Boolean);
    if (!cards.length) return;
    // remove selected cards from hand
    room.hands[socket.id] = hand.filter((_,i)=>!handIndices.includes(i));
    // put into discard (will become past for next player)
    room.discard = cards;
    broadcast(roomId);
  });

  socket.on("draw", ({ roomId, source }) => {
    const room = rooms[roomId]; if (!room) return;
    if (room.activePlayerId!==socket.id) return;
    if (source==="stock") {
      if (room.deck.length>0) {
        room.hands[socket.id].push(room.deck.pop());
      }
    } else if (source==="past") {
      if (room.pastDiscard && room.pastDiscard.length) {
        room.hands[socket.id].push(room.pastDiscard.pop());
      }
    }
    // End of turn: immediate -> past, advance turn
    room.pastDiscard = room.discard;
    room.discard = [];
    nextTurn(room);
    broadcast(roomId);
  });

  socket.on("lakdi", ({ roomId }) => {
    const room = rooms[roomId]; if (!room) return;
    room.declared = true;
    // compute scores
    const scores = {};
    room.players.forEach(p => {
      const hand = room.hands[p.id]||[];
      const tot = hand.reduce((a,c)=> {
        if (c.r==="A") return a+1;
        if (c.r==="J") return a+11;
        if (c.r==="Q") return a+12;
        if (c.r==="K") return a+13;
        return a+parseInt(c.r);
      },0);
      scores[p.id]=tot;
    });
    io.to(roomId).emit("state", { state: { declared:true, scores } });
  });

  socket.on("addBot", ({ roomId, difficulty }) => {
    const room = rooms[roomId]; if (!room) return;
    const id = "bot-"+Math.random().toString(36).slice(2,6);
    room.players.push({ id, name:`Bot(${difficulty||"easy"})` });
    room.hands[id] = [];
    broadcast(roomId);
  });

  socket.on("disconnect", () => {
    console.log("[disconnect]", socket.id);
    for (const [rid,room] of Object.entries(rooms)) {
      room.players = room.players.filter(p=>p.id!==socket.id);
      delete room.hands[socket.id];
      if (room.players.length===0) delete rooms[rid];
    }
  });
});

// === Start server ===
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log("Lakdi server listening on", PORT);
});
