// server/server.js
// Node + Express + Socket.IO Lakdi server
// - Rooms with create/join
// - Start game, turns, discard/draw
// - Lakdi with first-cut priority (flat +50 invalid)
// - Round results, next round, game over threshold

const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/* ---------- Serve client from ../client (robust) ---------- */
const candidates = [
  path.join(__dirname, "../client"),    // Root Directory = server
  path.join(process.cwd(), "client"),   // Root Directory = repo root
  path.join(__dirname, "../../client"), // safety
];
let CLIENT_DIR = null;
for (const p of candidates) {
  if (fs.existsSync(path.join(p, "index.html"))) { CLIENT_DIR = p; break; }
}
if (!CLIENT_DIR) {
  console.error("[Lakdi] FATAL: client/index.html not found. Checked:");
  candidates.forEach(p => console.error(" -", p));
  process.exit(1);
}
console.log("[Lakdi] Serving client from:", CLIENT_DIR);

app.use(express.static(CLIENT_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(CLIENT_DIR, "index.html")));
app.get("/health", (_req, res) => res.send("ok"));
// SPA fallback (avoid catching socket.io path)
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/socket.io")) return next();
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

/* --------- Helpers --------- */
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const SUITS = ["hearts","diamonds","clubs","spades"];
const sym = {hearts:"♥",diamonds:"♦",clubs:"♣",spades:"♠"};
const v = r => r==="A"?1:r==="J"?11:r==="Q"?12:r==="K"?13:parseInt(r,10);
const sum = hand => hand.reduce((a,c)=>a+v(c.rank),0);
const label = c => `${c.rank}${sym[c.suit]}`;
const deck = (n=1) => {
  const d=[];
  for(let k=0;k<n;k++) for(const s of SUITS) for(const r of RANKS) d.push({suit:s,rank:r});
  for(let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}
  return d;
};
const code6 = () => crypto.randomBytes(3).toString("hex").toUpperCase();

function visibleState(room) {
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    turn: room.turn,
    currentTurn: room.turn,       // alias for clients that expect currentTurn
    pastTop: room.pastTop || null,
    stockCount: room.deck.length,
    firstTurn: room.firstTurn,
    players: room.players.map(p => ({
      id:p.id, name:p.name, score:p.score, isHost: p.id===room.host
    })),
  };
}

/* --------- In-memory Rooms --------- */
const rooms = new Map();
// room = {
//   code, host, phase:'lobby'|'playing',
//   round, deck, hands: {pid:[]}, turn, pastTop, firstTurn,
//   players:[{id,name,score,socketId}],
//   pendingCut: {callerId, responded:Set, resolved:boolean, handsSnapshot:{}}
// }

function nextPlayer(room, pid) {
  const idx = room.players.findIndex(p => p.id===pid);
  return room.players[(idx+1)%room.players.length].id;
}
function playersAfter(room, pid) {
  const arr=[]; let cur = pid;
  for(let i=1;i<room.players.length;i++){ cur = nextPlayer(room, cur); arr.push(cur); }
  return arr;
}

function startGame(room) {
  room.phase = "playing";
  room.round = 1;
  room.deck = deck(Math.ceil(room.players.length/6));
  room.hands = {};
  room.players.forEach(p => { room.hands[p.id] = room.deck.splice(-3); });
  room.pastTop = room.deck.pop() || null;
  room.turn = room.host;
  room.firstTurn = true;
  io.in(room.code).emit("room_state", visibleState(room));
  room.players.forEach(p => {
    io.to(p.socketId).emit("your_hand", room.hands[p.id]);
  });
}

function startNextRound(room) {
  room.round += 1;
  room.deck = deck(Math.ceil(room.players.length/6));
  room.hands = {};
  room.players.forEach(p => { room.hands[p.id] = room.deck.splice(-3); });
  room.pastTop = room.deck.pop() || null;
  room.firstTurn = true;
  room.turn = room.players[0].id;
  io.in(room.code).emit("room_state", visibleState(room));
  room.players.forEach(p => io.to(p.socketId).emit("your_hand", room.hands[p.id]));
}

function endTurn(room, pid, immediate) {
  room.pastTop = immediate && immediate.length ? immediate[immediate.length-1] : room.pastTop;
  room.turn = nextPlayer(room, pid);
  room.firstTurn = false;
  io.in(room.code).emit("room_state", visibleState(room));
  room.players.forEach(p => io.to(p.socketId).emit("your_hand", room.hands[p.id]));
}

function findRoomBySocket(socket) {
  for (const r of rooms.values()) {
    if (r.players.some(p => p.socketId === socket.id)) return r;
  }
  return null;
}

/* --------- Socket.IO --------- */
io.on("connection", (socket) => {

  socket.on("create_room", ({name}, ack) => {
    try {
      const code = code6().slice(0,6);
      const room = {
        code, host: socket.id, phase:"lobby", round:0,
        deck:[], hands:{}, turn:null, pastTop:null, firstTurn:true,
        players:[{id:socket.id, name:name||"Host", score:0, socketId:socket.id}],
        pendingCut:null,
      };
      rooms.set(code, room);
      socket.join(code);
      ack && ack({ ok:true, code, meId:socket.id, state: visibleState(room) });
      io.to(socket.id).emit("room_state", visibleState(room));
    } catch(e) {
      ack && ack({ ok:false, error: e.message });
    }
  });

  socket.on("join_room", ({name, code}, ack) => {
    try{
      code = (code||"").toUpperCase();
      const room = rooms.get(code);
      if(!room) return ack && ack({ ok:false, error:"Room not found" });
      if(room.phase!=="lobby") return ack && ack({ ok:false, error:"Game already started" });
      if(room.players.length>=6) return ack && ack({ ok:false, error:"Room full" });
      room.players.push({id:socket.id, name:name||"Player", score:0, socketId:socket.id});
      socket.join(code);
      ack && ack({ ok:true, code, meId:socket.id, state: visibleState(room) });
      io.in(code).emit("room_state", visibleState(room));
    }catch(e){
      ack && ack({ ok:false, error:e.message });
    }
  });

  socket.on("start_game", (data) => {
    const room = rooms.get((data&&data.code)||"");
    if(!room) return;
    if(room.host!==socket.id) return;
    if(room.players.length<2) return;
    startGame(room);
  });

  socket.on("discard", ({code, cards}, ack) => {
    const room = rooms.get(code); if(!room||room.turn!==socket.id) return;
    const hand = room.hands[socket.id] || [];
    // validate 1..3 same rank
    if(!cards || !cards.length || cards.length>3) return;
    const r0 = cards[0].rank;
    if(!cards.every(c=>c.rank===r0)) return;
    // remove from hand
    const toKey = c => `${c.rank}_${c.suit}`;
    const set = new Set(cards.map(toKey));
    let removed=[];
    room.hands[socket.id] = hand.filter(c=>{
      const k=toKey(c);
      if(set.has(k) && !removed.some(x=>toKey(x)===k)) { removed.push(c); return false; }
      return true;
    });
    socket.data.immediate = removed; // store to socket for endTurn
    ack && ack({ok:true});
    io.in(code).emit("room_state", visibleState(room));
    io.to(socket.id).emit("your_hand", room.hands[socket.id]);
  });

  socket.on("draw", ({code, source}, ack) => {
    const room = rooms.get(code); if(!room||room.turn!==socket.id) return;
    const hand = room.hands[socket.id] || [];
    // accept "past" or "discard" for drawing from past pile; anything else -> stock
    if(source==="past" || source==="discard"){
      if(!room.pastTop) return;
      hand.push(room.pastTop);
      room.pastTop=null;
    }else{
      if(!room.deck.length) return;
      hand.push(room.deck.pop());
    }
    room.hands[socket.id] = hand;
    ack && ack({ok:true});
    endTurn(room, socket.id, socket.data.immediate || []);
    socket.data.immediate = [];
  });

  socket.on("call_lakdi", ({code}) => {
    const room = rooms.get(code); if(!room) return;
    // Open a pending cut sequence
    const callerId = socket.id;
    const hands = room.hands;
    room.pendingCut = {
      roomCode:code, callerId,
      responded:new Set(), resolved:false,
      handsSnapshot: JSON.parse(JSON.stringify(hands))
    };

    // Broadcast declaration (clients implement first-cut priority UX)
    io.in(code).emit("lakdi_declared", {
      callerId,
      callerName: (room.players.find(p=>p.id===callerId)||{}).name,
      callerHand: hands[callerId] || [],
    });
  });

  socket.on("respond_cut", ({code, action}) => {
    const room = rooms.get(code); if(!room||!room.pendingCut) return;
    const pend = room.pendingCut;
    if(pend.resolved) return;
    const callerId = pend.callerId;

    // First valid "cut" resolves immediately
    if(action==="cut"){
      pend.resolved = true;
      const hands = room.hands;
      const totals = {};
      room.players.forEach(p => totals[p.id] = sum(hands[p.id]||[]));

      const callerT = totals[callerId] ?? 1e9;
      const myT = totals[socket.id] ?? 1e9;

      let winnerId, penalties={};
      if(myT < callerT){
        winnerId = socket.id; // valid cut → cutter wins
      }else{
        winnerId = callerId;  // invalid cut → declarer stands
        penalties[socket.id] = 50; // flat +50 on incorrect cut
      }

      // apply scores
      room.players.forEach(p=>{
        if(p.id===winnerId) return; // winner gets 0
        else if(penalties[p.id]===50) p.score += 50; // flat
        else p.score += totals[p.id] || 0;
      });

      // send results
      io.in(code).emit("round_result", {
        winnerId,
        hands,
        totals,
        penalties,
        scores: room.players.map(p=>({id:p.id,score:p.score,name:p.name}))
      });

      room.pendingCut = null;
      return;
    }

    // "stand" path — wait until all others (except caller) stand
    pend.responded.add(socket.id);
    const others = room.players.filter(p=>p.id!==callerId);
    const allStood = others.every(p => pend.responded.has(p.id));
    if(allStood){
      pend.resolved = true;
      const hands = room.hands;
      const totals = {};
      room.players.forEach(p => totals[p.id] = sum(hands[p.id]||[]));

      // lowest hand total wins; if caller not lowest, caller gets +50
      let winnerId = room.players[0].id, best = Infinity;
      room.players.forEach(p=>{ const t=totals[p.id]; if(t<best){best=t; winnerId=p.id;} });
      const penalties = {};
      if(winnerId !== callerId) penalties[callerId] = 50;

      room.players.forEach(p=>{
        if(p.id===winnerId) return;
        else if(penalties[p.id]===50) p.score += 50;
        else p.score += totals[p.id] || 0;
      });

      io.in(code).emit("round_result", {
        winnerId,
        hands,
        totals,
        penalties,
        scores: room.players.map(p=>({id:p.id,score:p.score,name:p.name}))
      });

      room.pendingCut = null;
    }
  });

  socket.on("next_round", ({code}) => {
    const room = rooms.get(code); if(!room) return;
    const max = Math.max(...room.players.map(p=>p.score));
    if(max >= 200){ // game over
      io.in(code).emit("game_over", {
        scores: room.players.map(p=>({id:p.id,name:p.name,score:p.score}))
      });
      room.phase="lobby";
      room.turn=null; room.deck=[]; room.hands={}; room.pastTop=null; room.firstTurn=true; room.round=0;
      return;
    }
    startNextRound(room);
  });

  socket.on("disconnect", ()=>{
    const room = findRoomBySocket(socket);
    if(!room) return;
    // remove player
    room.players = room.players.filter(p=>p.socketId !== socket.id);
    delete room.hands[socket.id];
    // host fallback
    if(room.host===socket.id && room.players.length) room.host = room.players[0].id;
    if(room.players.length===0){
      rooms.delete(room.code);
    }else{
      // if current turn left, move to next
      if(room.turn===socket.id) room.turn = nextPlayer(room, socket.id);
      io.in(room.code).emit("room_state", visibleState(room));
      room.players.forEach(p => io.to(p.socketId).emit("your_hand", room.hands[p.id]||[]));
    }
  });

});

/* --------- Start Server --------- */
const PORT = process.env.PORT || 10000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Lakdi server running on", PORT);
});
