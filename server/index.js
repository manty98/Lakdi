// server/index.js
import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
// Allow your GitHub Pages origin
app.use(cors({ origin: ["https://manty98.github.io"], credentials: true }));

app.get("/health", (_req, res) => res.send("OK"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ["https://manty98.github.io"], methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 8080;

/* -------------------- Game State -------------------- */
const rooms = {}; // code -> Room

function newRoom(code, hostId, hostName) {
  return {
    code,
    host: hostId,
    players: [{ id: hostId, name: hostName, score: 0, isHost: true }], // {id,name,score,isHost,isBot?}
    hands: {},          // { playerId: Card[] }
    stock: [],          // Card[]
    discard: [],        // Card[]
    currentTurn: null,  // playerId
    gamePhase: "lobby", // "lobby" | "playing" | "showdown"
    endThreshold: 200,
    turnsElapsed: 0,
    lakdiWindow: "START", // "START" | "POST_DRAW"
    // cut phase
    lakdiCallerId: null,
    cutPhase: false,
    cutDeadline: null,
    cutActed: {}, // playerId -> true when acted
    lakdiSnapshot: null // { totals: {playerId:number} }
  };
}

function emitRoom(code) {
  const room = rooms[code];
  if (room) io.to(code).emit("room_state", room);
}

/* -------------------- Helpers -------------------- */
function genRoomCode() {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}
const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
function buildDecks(nPlayers) {
  const decks = Math.max(1, Math.ceil(nPlayers / 6));
  const out = [];
  for (let d=0; d<decks; d++) {
    for (const s of SUITS) for (const r of RANKS) out.push({ suit:s, rank:r });
  }
  return shuffle(out);
}
function shuffle(a){ const arr=[...a]; for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function val(rank){ if(rank==="A")return 1; if(rank==="J")return 11; if(rank==="Q")return 12; if(rank==="K")return 13; return parseInt(rank,10); }
function total(hand){ return (hand||[]).reduce((s,c)=> s+val(c.rank), 0); }
function sameRank(cards){ return cards.length>0 && cards.every(c => c.rank===cards[0].rank); }
function nextTurn(room){
  const idx = room.players.findIndex(p=>p.id===room.currentTurn);
  room.currentTurn = room.players[(idx+1) % room.players.length].id;
  room.lakdiWindow = "START";
}
function ensureReshuffle(room){
  if (room.stock.length === 0 && room.discard.length > 1){
    const top = room.discard.pop();
    room.stock = shuffle(room.discard);
    room.discard = [top];
  }
}

/* -------------------- CPU Bot -------------------- */
function isBot(p){ return !!p.isBot; }
function addBotIfSolo(room){
  if (room.players.length === 1) {
    const botId = `bot_${Date.now()}`;
    room.players.push({ id: botId, name: "CPU Lakdi", score: 0, isHost: false, isBot: true });
  }
}
function botPlayTurn(room){
  const bot = room.players.find(p=>isBot(p));
  if (!bot || room.currentTurn !== bot.id) return;
  // tiny delay so humans see it happen
  setTimeout(() => {
    // Must DISCARD first (if 3 cards)
    const hand = room.hands[bot.id] || [];
    if (hand.length !== 3) return;
    // Try to discard a pair/triple; else highest single
    const byRank = {};
    hand.forEach(c => { byRank[c.rank] = (byRank[c.rank]||[]).concat([c]); });
    let toDiscard = null;
    for (const r of Object.keys(byRank)) if (byRank[r].length >= 2) { toDiscard = byRank[r].slice(0, Math.min(3, byRank[r].length)); break; }
    if (!toDiscard) {
      // pick highest single
      toDiscard = [ hand.slice().sort((a,b)=>val(b.rank)-val(a.rank))[0] ];
    }
    // remove from hand
    toDiscard.forEach(c => {
      const idx = hand.findIndex(h => h.rank===c.rank && h.suit===c.suit);
      if (idx>=0) hand.splice(idx,1);
    });
    room.discard.push(toDiscard[toDiscard.length-1]);
    room.turnsElapsed++;
    room.lakdiWindow = "POST_DRAW";

    // Then DRAW (stock preferred)
    ensureReshuffle(room);
    if (room.stock.length>0) hand.push(room.stock.pop());
    else if (room.discard.length>0) hand.push(room.discard.pop());

    nextTurn(room);
    emitRoom(room.code);

    // Recursively continue if next is also bot (not needed now)
  }, 400);
}

/* -------------------- Cut Resolution -------------------- */
const CUT_PENALTY = 50;

function snapshotTotals(room){
  const totals = {};
  room.players.forEach(p => totals[p.id] = total(room.hands[p.id]||[]));
  room.lakdiSnapshot = { totals };
}

function endCutValid(room, cutterId){
  const { totals } = room.lakdiSnapshot;
  const callerId = room.lakdiCallerId;
  room.players.forEach(p => {
    if (p.id === cutterId) p.score += 0;
    else if (p.id === callerId) p.score += CUT_PENALTY;     // flat +50
    else p.score += totals[p.id];
  });
  enterShowdown(room);
}

function endCutInvalid(room, cutterId){
  const { totals } = room.lakdiSnapshot;
  const callerId = room.lakdiCallerId;
  room.players.forEach(p => {
    if (p.id === callerId) p.score += 0;
    else if (p.id === cutterId) p.score += CUT_PENALTY;     // flat +50
    else p.score += totals[p.id];
  });
  enterShowdown(room);
}

function endNoCut(room){
  const { totals } = room.lakdiSnapshot;
  const callerId = room.lakdiCallerId;
  room.players.forEach(p => {
    if (p.id === callerId) p.score += 0;
    else p.score += totals[p.id];
  });
  enterShowdown(room);
}

function enterShowdown(room){
  room.gamePhase = "showdown";
  room.cutPhase = false;
  room.cutDeadline = null;
  room.cutActed = {};
  room.lakdiCallerId = null;
  room.lakdiSnapshot = null;
  emitRoom(room.code);
  // If game over?
  const maxScore = Math.max(...room.players.map(p=>p.score));
  if (maxScore >= room.endThreshold) return; // client can show final results
}

/* -------------------- New Round -------------------- */
function dealNewRound(room){
  // rotate dealer/currentTurn for fairness
  const idx = room.players.findIndex(p=>p.id===room.currentTurn);
  const dealerIdx = (idx + 1 + room.players.length) % room.players.length;
  room.currentTurn = room.players[dealerIdx].id;

  const deck = buildDecks(room.players.length);
  room.stock = deck;
  room.discard = [];
  room.hands = {};
  room.players.forEach(p => {
    room.hands[p.id] = [ room.stock.pop(), room.stock.pop(), room.stock.pop() ];
  });
  // Start discard pile with a visible card
  room.discard.push(room.stock.pop());

  room.turnsElapsed = 0;
  room.lakdiWindow = "START";
  room.gamePhase = "playing";
}

/* -------------------- Sockets -------------------- */
io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("create_room", ({ name }, cb) => {
    const code = genRoomCode();
    const room = newRoom(code, socket.id, name || "Player");
    rooms[code] = room;
    socket.join(code);
    cb?.({ code, me:{ id:socket.id, name: name||"Player" } });
    emitRoom(code);
  });

  socket.on("join_room", ({ code, name }, cb) => {
    const room = rooms[code];
    if (!room) return cb?.({ error:"Room not found" });
    if (room.gamePhase !== "lobby") return cb?.({ error:"Game already started" });
    if (room.players.find(p=>p.name.toLowerCase()===String(name||"").toLowerCase()))
      return cb?.({ error:"Name already taken" });
    room.players.push({ id: socket.id, name: name||"Player", score: 0, isHost: false });
    socket.join(code);
    cb?.({ code, me:{ id:socket.id, name: name||"Player" } });
    emitRoom(code);
  });

  socket.on("start_game", ({ code, endThreshold }, cb) => {
    const room = rooms[code];
    if (!room) return cb?.({ error:"Room not found" });
    if (room.host !== socket.id) return cb?.({ error:"Only host can start" });

    room.endThreshold = (endThreshold===300 ? 300 : 200);

    // If only one human, add CPU bot
    addBotIfSolo(room);

    // Initial deal
    const deck = buildDecks(room.players.length);
    room.stock = deck;
    room.discard = [];
    room.hands = {};
    room.players.forEach(p => {
      room.hands[p.id] = [ room.stock.pop(), room.stock.pop(), room.stock.pop() ];
    });
    room.discard.push(room.stock.pop());
    room.currentTurn = room.players[0].id;
    room.turnsElapsed = 0;
    room.lakdiWindow = "START";
    room.gamePhase = "playing";

    emitRoom(code);
    cb?.({ ok:true });

    // If bot starts, let it play
    botPlayTurn(room);
  });

  // DISCARD (must have 3 cards; only 1/2/3 of same rank)
  socket.on("discard", ({ code, cards }, cb) => {
    const room = rooms[code]; if (!room) return cb?.({ error:"Room not found" });
    if (room.currentTurn !== socket.id) return cb?.({ error:"Not your turn" });

    const hand = room.hands[socket.id]; if (!hand || hand.length !== 3) return cb?.({ error:"You must discard with 3 cards" });
    if (!Array.isArray(cards) || cards.length<1 || cards.length>3) return cb?.({ error:"Discard 1-3 cards" });
    if (!sameRank(cards)) return cb?.({ error:"Cards must be same rank" });

    // verify ownership & remove
    for (const c of cards) {
      const idx = hand.findIndex(h=>h.rank===c.rank && h.suit===c.suit);
      if (idx<0) return cb?.({ error:"Card not in hand" });
    }
    // remove
    for (const c of cards) {
      const idx = hand.findIndex(h=>h.rank===c.rank && h.suit===c.suit);
      hand.splice(idx,1);
    }
    // top of discard = last discarded
    room.discard.push(cards[cards.length-1]);

    room.turnsElapsed++;
    room.lakdiWindow = "POST_DRAW";
    emitRoom(code);
    cb?.({ ok:true });
  });

  // DRAW (exactly one, after discard)
  socket.on("draw", ({ code, source }, cb) => {
    const room = rooms[code]; if (!room) return cb?.({ error:"Room not found" });
    if (room.currentTurn !== socket.id) return cb?.({ error:"Not your turn" });

    const hand = room.hands[socket.id]; if (!hand || hand.length !== 2) return cb?.({ error:"You must draw with 2 cards" });

    if (source === "stock") {
      ensureReshuffle(room);
      if (!room.stock.length) return cb?.({ error:"No stock available" });
      hand.push(room.stock.pop());
    } else if (source === "discard") {
      if (!room.discard.length) return cb?.({ error:"Discard is empty" });
      hand.push(room.discard.pop());
    } else {
      return cb?.({ error:"Invalid draw source" });
    }

    // pass turn
    nextTurn(room);
    emitRoom(code);
    cb?.({ ok:true });

    // If bot turn now, let it play
    botPlayTurn(room);
  });

  // CALL LAKDI (not allowed on first turn)
  socket.on("call_lakdi", ({ code }, cb) => {
    const room = rooms[code]; if (!room) return cb?.({ error:"Room not found" });
    if (room.currentTurn !== socket.id) return cb?.({ error:"Not your turn" });
    if (room.turnsElapsed === 0) return cb?.({ error:"Cannot call Lakdi on first turn" });

    snapshotTotals(room);
    room.lakdiCallerId = socket.id;
    room.cutPhase = true;
    room.cutDeadline = Date.now() + 7000;
    room.cutActed = {};
    emitRoom(code);
    cb?.({ ok:true });

    // Auto finalize when deadline hits (server-side safety)
    setTimeout(() => {
      const stillCutting = rooms[code] && rooms[code].cutPhase && rooms[code].lakdiCallerId === socket.id;
      if (!stillCutting) return;
      // if any cutter already resolved, this won't run
      endNoCut(rooms[code]);
      emitRoom(code);
    }, 7200);
  });

  // CUT action (valid/invalid penalty resolution)
  socket.on("cut", ({ code }, cb) => {
    const room = rooms[code]; if (!room) return cb?.({ error:"Room not found" });
    if (!room.cutPhase) return cb?.({ error:"No active cut phase" });
    if (socket.id === room.lakdiCallerId) return cb?.({ error:"Caller cannot cut" });
    if (room.cutActed[socket.id]) return cb?.({ error:"Already acted" });
    if (Date.now() > (room.cutDeadline||0)) return cb?.({ error:"Cut window closed" });

    room.cutActed[socket.id] = true;

    const myTotal = total(room.hands[socket.id]||[]);
    const callerTotal = total(room.hands[room.lakdiCallerId]||[]);

    if (myTotal <= callerTotal) {
      endCutValid(room, socket.id);
    } else {
      endCutInvalid(room, socket.id);
    }
    emitRoom(code);
    cb?.({ ok:true });
  });

  // PASS CUT (no penalty)
  socket.on("pass_cut", ({ code }, cb) => {
    const room = rooms[code]; if (!room) return cb?.({ error:"Room not found" });
    if (!room.cutPhase) return cb?.({ error:"No active cut phase" });
    if (socket.id === room.lakdiCallerId) return cb?.({ error:"Caller cannot pass" });
    if (room.cutActed[socket.id]) return cb?.({ error:"Already acted" });

    room.cutActed[socket.id] = true;
    // If everyone except caller has acted (all passed) -> finalize no cut now
    const others = room.players.filter(p=>p.id!==room.lakdiCallerId);
    const allActed = others.every(p => room.cutActed[p.id]);
    if (allActed) endNoCut(room);

    emitRoom(code);
    cb?.({ ok:true });
  });

  // NEXT ROUND (client calls after showdown)
  socket.on("next_round", ({ code }, cb) => {
    const room = rooms[code]; if (!room) return cb?.({ error:"Room not found" });
    // If game already ended (max score >= threshold), you could refuse or reset — here we just deal next.
    dealNewRound(room);
    emitRoom(code);
    cb?.({ ok:true });

    botPlayTurn(room);
  });

  socket.on("disconnect", () => {
    console.log("disconnected:", socket.id);
    // (optional) remove players who leave; keep it simple for now
  });
});

server.listen(PORT, () => console.log("Lakdi server running on", PORT));
