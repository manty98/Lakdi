// client/script.js
let socket = null;
let STATE = null;
let SELECTED = new Set();
let ROOM = null;

const $ = (id) => document.getElementById(id);
const setErr = (t="") => ($("err").textContent = t);
const setMsg = (t="") => ($("msg").textContent = t);

function connect() {
  ROOM = $("room").value.trim() || "demo";
  const name = $("name").value.trim() || "Player";

  if (socket) socket.disconnect();
  socket = io(); // same origin

  socket.on("connect", () => {
    socket.emit("join", { roomId: ROOM, name });
    setMsg("Connected. Joining room…");
  });

  socket.on("joined", (info) => {
    setMsg(`Joined room ${info.roomId}. ${info.host ? "You are host." : ""}`);
  });

  socket.on("state", ({ state }) => {
    STATE = state;
    render();
  });

  socket.on("error", (e) => setErr(e));
  socket.on("disconnect", () => setMsg("Disconnected"));
}

function render() {
  setErr("");
  if (!STATE) return;

  // players list
  const ul = $("players");
  ul.innerHTML = "";
  STATE.players.forEach(p => {
    const li = document.createElement("li");
    const turn = (p.id === STATE.activePlayerId) ? " (turn)" : "";
    const conn = p.connected ? "" : " [left]";
    li.textContent = `${p.name}${turn} – ${p.handCount} cards${conn}`;
    ul.appendChild(li);
  });

  // piles
  $("stockCount").textContent = STATE.stockCount;
  renderCards($("immediate"), STATE.immediateDiscard);
  renderCards($("past"), STATE.pastDiscard);

  // hand
  const handDiv = $("hand");
  handDiv.innerHTML = "";
  const myHand = STATE.you?.hand || [];
  SELECTED.forEach(i => { if (i >= myHand.length) SELECTED.delete(i); });

  myHand.forEach((c, i) => {
    const el = document.createElement("div");
    el.className = "card-chip" + (SELECTED.has(i) ? " selected" : "");
    el.textContent = `${c.r}${c.s}`;
    el.title = `Index ${i}`;
    el.onclick = () => { SELECTED.has(i) ? SELECTED.delete(i) : SELECTED.add(i); render(); };
    handDiv.appendChild(el);
  });

  // turn & deadline
  const isMyTurn = STATE.activePlayerId === STATE.you?.id;
  $("turn").textContent = isMyTurn ? "Your turn" : "Waiting…";
  if (STATE.turnDeadlineMs) {
    const secs = Math.max(0, Math.ceil((STATE.turnDeadlineMs - Date.now()) / 1000));
    $("deadline").textContent = `Timer: ${secs}s`;
  } else {
    $("deadline").textContent = "";
  }

  // controls
  const disabled = (!isMyTurn) || STATE.declared;
  $("discardBtn").disabled = disabled;
  $("drawStockBtn").disabled = disabled;
  $("drawPastBtn").disabled = disabled;
  $("lakdiBtn").disabled = disabled;

  // showdown
  if (STATE.declared) showCut();
  else $("cut").innerHTML = "";
}

function renderCards(container, cards) {
  container.innerHTML = "";
  cards.forEach(c => {
    const el = document.createElement("div");
    el.className = "card-chip";
    el.textContent = `${c.r}${c.s}`;
    container.appendChild(el);
  });
}

function showCut() {
  // Scores aren’t streamed separately here; we recompute UI from public state only.
  // For simplicity, just indicate who called first (STATE.firstCutBy).
  const div = $("cut");
  div.innerHTML = `<h3>Showdown</h3>
    <div class="muted">First cut by: ${nameOf(STATE.firstCutBy)}</div>
    <div class="muted">(Scores are computed server-side on call; future enhancement: stream final points table.)</div>`;
}

function nameOf(id) {
  const p = STATE.players.find(x => x.id === id);
  return p ? p.name : "(unknown)";
}

/* UI actions */
$("joinBtn").onclick = connect;

$("startBtn").onclick = () => {
  if (!socket) return;
  const hand = Number($("handSize").value || 5);
  const sec = Number($("turnSec").value || 25);
  socket.emit("start", { roomId: ROOM, handSize: hand, turnSeconds: sec });
};

$("discardBtn").onclick = () => {
  if (!socket || !STATE) return;
  const myHand = STATE.you?.hand || [];
  const n = SELECTED.size;
  if (n < 1 || n > 3) return setErr("Select 1–3 cards");
  const arr = Array.from(SELECTED.values()).sort((a,b)=>a-b);
  const ranks = arr.map(i => myHand[i].r);
  if (!ranks.every(r => r === ranks[0])) return setErr("Cards must share the same rank");
  socket.emit("discard", { roomId: ROOM, handIndices: arr });
  SELECTED.clear();
};

$("drawStockBtn").onclick = () => socket?.emit("draw", { roomId: ROOM, source: "stock" });
$("drawPastBtn").onclick = () => socket?.emit("draw", { roomId: ROOM, source: "past" });
$("lakdiBtn").onclick = () => socket?.emit("lakdi", { roomId: ROOM });

// Host-only: add bots
$("addEasy").onclick  = () => socket?.emit("addBot", { roomId: ROOM, difficulty: "easy" });
$("addMed").onclick   = () => socket?.emit("addBot", { roomId: ROOM, difficulty: "medium" });
$("addHard").onclick  = () => socket?.emit("addBot", { roomId: ROOM, difficulty: "hard" });

// Lightweight timer repaint
setInterval(() => { if (STATE?.turnDeadlineMs) render(); }, 500);

