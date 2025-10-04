// server/server.js (ESM, full file - FINAL VERSION)
// Lakdi server: Express + Socket.IO
// - Create / Join rooms
// - Start game, turns, discard/draw
// - Past pile sync across clients (discard_update / draw_update)
// - Minimal round/next_round scaffolding (re-deals 3 cards)
// NOTE: Requires Node 18+ with "type": "module" in package.json

import express from "express";
import http from "http";
import { Server } from "socket.io";
import crypto from "crypto";
import cors from "cors";

/* ---------- App & IO ---------- */
const app = express();
app.use(cors());

app.get("/health", (_req, res) => res.send("ok"));

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    path: "/socket.io",
});

/* ---------- Game Helpers ---------- */
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const v = (r) => (r === "A" ? 1 : r === "J" ? 11 : r === "Q" ? 12 : r === "K" ? 13 : parseInt(r, 10));
const sum = (hand) => hand.reduce((a, c) => a + v(c.rank), 0);

function deck(n = 1) {
    const d = [];
    for (let k = 0; k < n; k++)
        for (const s of SUITS)
            for (const r of RANKS) d.push({ suit: s, rank: r });
    for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
}

function code6() {
    return crypto.randomBytes(4).toString("hex").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function nextPlayer(room, pid) {
    const idx = room.players.findIndex(p => p.id === pid);
    if (idx < 0) return room.players[0]?.id ?? null;
    return room.players[(idx + 1) % room.players.length].id;
}

/* ---------- State helpers ---------- */
function visibleState(room) {
    const cardCounts = {};
    for (const p of room.players) {
        cardCounts[p.id] = (room.hands[p.id] || []).length;
    }
    return {
        code: room.code,
        phase: room.phase,
        round: room.round,
        turn: room.turn,
        currentTurn: room.turn,
        pastTop: room.pastTop || null,
        pastDiscardTop: room.pastTop || null,
        stockCount: room.deck.length,
        firstTurn: room.firstTurn,
        cardCounts,
        players: room.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score || 0,
            isHost: p.id === room.host
        })),
        hostId: room.host,
    };
}

function buildStateFor(room, pid) {
    const st = visibleState(room);
    st.me = {
        id: pid,
        name: (room.players.find(p => p.id === pid) || {}).name
    };
    st.hands = { [pid]: room.hands[pid] || [] };
    return st;
}

function sendState(room) {
    for (const p of room.players) {
        io.to(p.socketId).emit("room_state", buildStateFor(room, p.id));
    }
}

/* ---------- In-memory Rooms ---------- */
const rooms = new Map();

function newRoom(code, hostId, hostName) {
    return {
        code,
        host: hostId,
        phase: "lobby",
        round: 0,
        deck: [],
        hands: {},
        turn: null,
        pastTop: null,
        firstTurn: true,
        players: [{
            id: hostId,
            name: hostName || "Player",
            score: 0,
            socketId: hostId
        }],
    };
}

/* ---------- Core Game Ops ---------- */
function startGame(room) {
    room.phase = "playing";
    room.round = 1;
    room.deck = deck(Math.ceil(room.players.length / 6));
    room.hands = {};
    for (const p of room.players) {
        room.hands[p.id] = room.deck.splice(-3);
    }
    // Seed Past with the first face-up card
    room.pastTop = room.deck.length ? room.deck.pop() : null;
    room.turn = room.host ?? room.players[0]?.id ?? null;
    room.firstTurn = true;
    sendState(room);
}

function startNextRound(room) {
    room.round += 1;
    room.deck = deck(Math.ceil(room.players.length / 6));
    for (const p of room.players) room.hands[p.id] = room.deck.splice(-3);
    room.pastTop = room.deck.length ? room.deck.pop() : null;
    room.firstTurn = true;
    room.turn = room.players[0]?.id ?? null;
    sendState(room);
}

/* ---------- Socket.IO Events ---------- */
io.on("connection", (socket) => {
    
    socket.on("create_room", ({ name }, ack) => {
        const code = code6();
        const room = newRoom(code, socket.id, name);
        rooms.set(code, room);
        socket.join(code);
        ack && ack({ ok: true, code, meId: socket.id });
        sendState(room);
    });

    socket.on("join_room", ({ name, code }, ack) => {
        code = (code || "").toUpperCase();
        const room = rooms.get(code);
        if (!room) return ack && ack({ ok: false, error: "Room not found" });
        if (room.phase !== "lobby") return ack && ack({ ok: false, error: "Game already started" });
        if (room.players.length >= 6) return ack && ack({ ok: false, error: "Room is full" });

        room.players.push({
            id: socket.id,
            name: name || "Player",
            score: 0,
            socketId: socket.id
        });
        socket.join(code);
        ack && ack({ ok: true, code, meId: socket.id });
        sendState(room);
    });

    socket.on("start_game", ({ code }) => {
        const room = rooms.get(code);
        if (!room || room.host !== socket.id || room.players.length < 2) return;
        startGame(room);
    });

    /* ---------- DISCARD (FIXED) ---------- */
    socket.on("discard", ({ code, cards }, ack) => {
        const room = rooms.get(code);
        if (!room || room.turn !== socket.id) return;

        const hand = room.hands[socket.id] || [];
        const r0 = cards && cards[0] && cards[0].rank;
        if (!cards || !cards.length || !cards.every(c => c.rank === r0)) return;

        // Remove cards from hand
        const toKey = c => `${c.rank}_${c.suit}`;
        const need = new Set(cards.map(toKey));
        const removed = [];
        room.hands[socket.id] = hand.filter(c => {
            const k = toKey(c);
            if (need.has(k) && !removed.some(x => toKey(x) === k)) {
                removed.push(c);
                return false;
            }
            return true;
        });

        // Store immediate discard temporarily (don't update pastTop yet)
        socket.data.immediate = removed;

        ack && ack({ ok: true });

        // Broadcast that discard happened (Past pile is NOT yet available)
        io.in(code).emit("discard_update", {
            playerId: socket.id,
            cards: removed,
            newPastTop: room.pastTop, // Still the OLD past pile
            nextTurn: room.turn // Turn hasn't changed yet
        });

        // Send updated state to refresh hand counts
        sendState(room);
    });

    /* ---------- DRAW (FIXED) ---------- */
    socket.on("draw", ({ code, source }, ack) => {
        const room = rooms.get(code);
        if (!room || room.turn !== socket.id) return;

        const hand = room.hands[socket.id] || [];

        if (source === "past" || source === "discard") {
            if (!room.pastTop) return;
            hand.push(room.pastTop);
            room.pastTop = null; // Consumed
        } else {
            if (!room.deck.length) return;
            hand.push(room.deck.pop());
        }

        room.hands[socket.id] = hand;

        // NOW update Past pile with the card(s) just discarded
        const immediate = socket.data.immediate || [];
        if (immediate.length) {
            room.pastTop = immediate[immediate.length - 1];
        }
        socket.data.immediate = [];

        // Advance turn
        const nextTurn = nextPlayer(room, socket.id);
        room.turn = nextTurn;
        room.firstTurn = false;

        ack && ack({ ok: true });

        // Broadcast draw completion with NEW past pile
        io.in(code).emit("draw_update", {
            playerId: socket.id,
            source,
            newPastTop: room.pastTop, // NOW shows the discarded card
            stockCount: room.deck.length,
            nextTurn: room.turn
        });

        // Send full state update
        sendState(room);
    });

    socket.on("next_round", ({ code }) => {
        const room = rooms.get(code);
        if (!room) return;
        startNextRound(room);
        io.in(code).emit("next_round_state", buildStateFor(room, room.turn));
    });

    socket.on("disconnect", () => {
        for (const [code, room] of rooms) {
            const before = room.players.length;
            room.players = room.players.filter(p => p.socketId !== socket.id);
            delete room.hands[socket.id];
            
            if (before !== room.players.length) {
                if (room.host === socket.id && room.players.length) {
                    room.host = room.players[0].id;
                }
                if (room.turn === socket.id) {
                    room.turn = nextPlayer(room, socket.id);
                }
                if (room.players.length === 0) {
                    rooms.delete(code);
                } else {
                    sendState(room);
                }
            }
        }
    });
});

/* ---------- Start Server ---------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("Lakdi server running on", PORT);
});