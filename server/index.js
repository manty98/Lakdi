import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors({ origin: ["https://manty98.github.io"], credentials: true }));

// health check
app.get("/health", (_req, res) => res.send("OK"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ["https://manty98.github.io"], methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 8080;

// ============= GAME STATE =============
const rooms = {}; // keyed by room.code

function newRoom(code, hostId, hostName) {
  return {
    code,
    host: hostId,
    players: [{ id: hostId, name: hostName, score: 0, isHost: true }],
    hands: {},           // { playerId: [cards] }
    stock: [],
    discard: [],
    currentTurn: null,
    gamePhase: "lobby",
    endThreshold: 200,
    turnsElapsed: 0,
    lakdiWindow: "START", // "START", "POST_DRAW"
    cutPhase: false,
    cutDeadline: null,
    cutActed: {},
    lakdiCallerId: null
  };
}

function emitRoom(code) {
  if (!rooms[code]) return;
  io.to(code).emit("room_state", rooms[code]);
}

// ============= HELPERS =============
function genRoomCode() {
  return Math.random().toString(36).substring(2, 6).toUpperCase();
}

function freshDeck(numDecks = 1) {
  const suits = ["hearts", "diamonds", "clubs", "spades"];
  const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  let deck = [];
  for (let d=0; d<numDecks; d++) {
    for (let s of suits) {
      for (let r of ranks) {
        deck.push({ suit:s, rank:r });
      }
    }
  }
  // shuffle
  for (let i=deck.length-1; i>0; i--){
    const j = Math.floor(Math.random()*(i+1));
    [deck[i],deck[j]]=[deck[j],deck[i]];
  }
  return deck;
}

// ============= SOCKET HANDLERS =============
io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("create_room", ({ name }, cb) => {
    const code = genRoomCode();
    const room = newRoom(code, socket.id, name);
    rooms[code] = room;
    socket.join(code);
    cb?.({ code, me:{id:socket.id, name} });
    emitRoom(code);
  });

  socket.on("join_room", ({ code, name }, cb) => {
    const room = rooms[code];
    if (!room) return cb?.({ error:"Room not found" });
    if (room.players.find(p=>p.name.toLowerCase()===name.toLowerCase()))
      return cb?.({ error:"Name already taken" });

    room.players.push({ id:socket.id, name, score:0 });
    socket.join(code);
    cb?.({ code, me:{id:socket.id, name} });
    emitRoom(code);
  });

  socket.on("start_game", ({ code, endThreshold }, cb) => {
    const room = rooms[code];
    if (!room) return cb?.({ error:"Room not found" });

    room.endThreshold = endThreshold || 200;
    room.gamePhase = "playing";
    room.stock = freshDeck(Math.ceil(room.players.length/6));
    room.discard = [];
    room.hands = {};

    // deal 3 cards each
    room.players.forEach(p => {
      room.hands[p.id] = [];
      for (let i=0;i<3;i++){
        room.hands[p.id].push(room.stock.pop());
      }
    });

    room.currentTurn = room.players[0].id;
    room.turnsElapsed = 0;
    emitRoom(code);
  });

  socket.on("discard", ({ code, cards }, cb) => {
    const room = rooms[code];
    if (!room) return;
    const hand = room.hands[socket.id] || [];
    // remove from hand
    cards.forEach(c => {
      const idx = hand.findIndex(h => h.rank===c.rank && h.suit===c.suit);
      if (idx>=0) hand.splice(idx,1);
    });
    // top discard = last of array
    if (cards.length>0) room.discard.push(cards[cards.length-1]);
    room.turnsElapsed++;
    room.lakdiWindow = "POST_DRAW";
    emitRoom(code);
  });

  socket.on("draw", ({ code, source }) => {
    const room = rooms[code];
    if (!room) return;
    const hand = room.hands[socket.id] || [];
    if (source==="stock") {
      if (room.stock.length===0) {
        // reshuffle discard
        const last = room.discard.pop();
        room.stock = freshDeck();
        room.discard=[last];
      }
      hand.push(room.stock.pop());
    } else if (source==="discard" && room.discard.length>0) {
      hand.push(room.discard.pop());
    }
    // next turn
    const idx = room.players.findIndex(p=>p.id===room.currentTurn);
    room.currentTurn = room.players[(idx+1)%room.players.length].id;
    room.lakdiWindow = "START";
    emitRoom(code);
  });

  socket.on("call_lakdi", ({ code }) => {
    const room = rooms[code];
    if (!room) return;
    room.lakdiCallerId = socket.id;
    room.cutPhase = true;
    room.cutDeadline = Date.now()+7000;
    room.cutActed = {};
    emitRoom(code);
  });

  socket.on("cut", ({ code }, cb) => {
    const room = rooms[code];
    if (!room) return;
    room.cutActed[socket.id] = "cut";
    emitRoom(code);
  });

  socket.on("pass_cut", ({ code }, cb) => {
    const room = rooms[code];
    if (!room) return;
    room.cutActed[socket.id] = "pass";
    emitRoom(code);
  });

  socket.on("disconnect", () => {
    console.log("disconnected:", socket.id);
    // optional: remove from rooms
  });
});

server.listen(PORT, () => console.log("Lakdi server running on", PORT));
