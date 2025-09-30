// server.js — serves the single-file client above
const path = require("path");
const express = require("express");

const app = express();

// Serve the current directory (so ./index.html works)
app.use(express.static(__dirname, {
  extensions: ["html"], // "/" → index.html
  maxAge: "1h",
  setHeaders(res, filePath) {
    if (filePath.endsWith("index.html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

// Health check for Render
app.get("/health", (_req, res) => res.status(200).send("ok"));

// Fallback to index.html (in case you add client routing later)
app.use((_req, res) => res.sendFile(path.join(__dirname, "index.html")));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lakdi static server listening on :${PORT}`);
});
