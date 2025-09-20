import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors({ origin: ["https://manty98.github.io"] }));
app.get("/health", (_req, res) => res.send("OK"));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

io.on("connection", (socket) => {
  socket.on("ping", (_, cb) => cb && cb("pong"));
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log("Lakdi server running on", PORT));
