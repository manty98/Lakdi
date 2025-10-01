// server/server.js
const path = require("path");
const fs = require("fs");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

/* ---- Resolve client/index.html robustly ---- */
const candidates = [
  path.join(__dirname, "../client"),       // typical: Root Directory = server
  path.join(process.cwd(), "client"),      // Root Directory = (blank), started from repo root
  path.join(__dirname, "../../client"),    // just in case
];

let CLIENT_DIR = null;
for (const p of candidates) {
  if (fs.existsSync(path.join(p, "index.html"))) {
    CLIENT_DIR = p;
    break;
  }
}
if (!CLIENT_DIR) {
  console.error(
    "FATAL: Could not find client/index.html. Checked:\n" +
      candidates.map((p) => ` - ${p}`).join("\n")
  );
  process.exit(1);
}

console.log("Serving client from:", CLIENT_DIR);

/* ---- Static + SPA fallback ---- */
app.use(express.static(CLIENT_DIR, { extensions: ["html"] }));
app.get("*", (_req, res) => {
  res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

/* ---- Minimal Socket.IO (keep your handlers here) ---- */
io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  // TODO: keep your existing room/game events here
  // socket.on('create_room', ...);
  // socket.on('join_room', ...);
  // socket.on('discard', ...);
  // socket.on('draw', ...);
  // socket.on('call_lakdi', ...);
});

/* ---- Start ---- */
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Lakdi static server listening on :${PORT}`);
});
