:root{
  --bg1:#1a4f3a; --bg2:#0d2818; --gold:#ffd700; --panel:rgba(255,255,255,.08);
  --panel-b:rgba(255,255,255,.15); --muted:rgba(255,255,255,.6);
  --btn-red:#ee5a24; --btn-blue:#4f46e5; --btn-green:#2ecc71;
  --card-b:#cbd5e1;
}

*{box-sizing:border-box}
html,body{height:100%}
body{
  margin:0;
  font-family:Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  background:linear-gradient(135deg,var(--bg1),var(--bg2));
  color:#fff;
  overflow:hidden;
}

/* Connection badge */
.connection-status{
  position:fixed;top:16px;left:16px;padding:10px 14px;border-radius:12px;
  background:rgba(46,204,113,.16);border:1px solid #2ecc71;color:#2ecc71;
  font-weight:700;z-index:50
}

/* Lobby */
.login-wrap{height:100%;display:flex;align-items:center;justify-content:center;padding:20px}
.login-card{
  width:min(560px,92vw);background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);
  border-radius:22px;padding:32px 28px;box-shadow:0 12px 22px rgba(0,0,0,.25)
}
.brand{display:flex;justify-content:center;align-items:center;gap:14px;margin-bottom:22px}
.brand .logo{width:46px;height:46px;border-radius:10px;background:var(--gold)}
.brand .title{font-size:48px;font-weight:900;color:var(--gold)}
.field{margin:12px 0}
.input{
  width:100%;padding:14px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.28);
  background:rgba(255,255,255,.08);color:#fff;font-size:16px;outline:none
}
.input::placeholder{color:var(--muted)}
.button{
  width:100%;padding:16px 18px;border:none;border-radius:14px;color:#fff;font-weight:900;
  letter-spacing:.2px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;
  box-shadow:0 8px 18px rgba(0,0,0,.2);transition:transform .1s ease
}
.button:active{transform:translateY(1px)}
.btn-join{background:linear-gradient(45deg,#ff6b6b,var(--btn-red))}
.btn-create{background:linear-gradient(45deg,#4834d4,var(--btn-blue))}
.btn-cpu{background:linear-gradient(45deg,#27ae60,var(--btn-green))}
.stack{display:grid;gap:14px;margin-top:10px}
.lobby-msg{margin-top:10px;color:#8ab4ff;font-weight:700}

/* Game container */
.game-container{height:100%;display:flex;flex-direction:column;position:relative}

/* Scoreboard */
.scoreboard{
  position:absolute;top:20px;right:20px;background:rgba(0,0,0,.85);backdrop-filter:blur(10px);
  border:1px solid rgba(255,255,255,.2);border-radius:16px;padding:18px 16px;min-width:240px;z-index:5
}
.scoreboard h3{margin:0 0 10px;color:var(--gold);text-align:center}
.room-info{text-align:center;margin-bottom:6px;font-weight:800;color:var(--gold)}
.score-item{
  display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;
  margin:6px 0;background:rgba(255,255,255,.06)
}
.score-item.winner{background:rgba(46,204,113,.28)}

/* Table */
.game-table{flex:1;display:flex;align-items:center;justify-content:center;position:relative;padding:22px}

/* Player seats */
.players-container{position:absolute;inset:0}
.player-seat{position:absolute;display:flex;flex-direction:column;align-items:center;gap:10px;min-width:120px}
.player-seat.active{animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.75}}
.player-info{background:var(--panel);border:1px solid var(--panel-b);border-radius:14px;padding:10px 14px;text-align:center}
.player-name{font-weight:800;margin-bottom:4px}
.player-score{font-size:14px;color:var(--gold)}
.player-cards{display:flex;gap:6px}
.card-back{width:30px;height:42px;border-radius:6px;background:linear-gradient(135deg,#2c3e50,#34495e);border:1px solid #3498db}

/* Seat presets (feel free to tune) */
.seat-top{top:8%;left:50%;transform:translateX(-50%)}
.seat-r1{top:20%;right:10%}
.seat-r2{top:50%;right:5%;transform:translateY(-50%)}
.seat-b1{bottom:20%;right:10%}
.seat-l1{bottom:20%;left:10%}
.seat-l2{top:50%;left:5%;transform:translateY(-50%)}

/* Center piles */
.table-center{position:relative;display:flex;align-
