const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

/* ------------ Helpers ------------ */
const suits = ["hearts", "diamonds", "clubs", "spades"];
const ranks = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function makeDeck(){
  const d=[];
  for(const s of suits) for(const r of ranks) d.push({suit:s,rank:r});
  return d;
}
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function val(r){
  if(r==="A") return 1;
  if(r==="J") return 11;
  if(r==="Q") return 12;
  if(r==="K") return 13;
  return parseInt(r,10);
}
function sumHand(hand){ return hand.reduce((a,c)=>a+val(c.rank),0); }

/* ------------ State ------------ */
let rooms={};

/* ------------ Core Logic ------------ */
function startGame(code){
  const room=rooms[code];
  if(!room) return;
  room.phase="play";
  room.deck=shuffle(makeDeck());
  room.discard=[];
  room.discardTop=null;
  room.stock=room.deck.slice();
  room.stockCount=room.stock.length;
  room.hands={};
  room.players.forEach(p=>{
    room.hands[p.id]=room.stock.splice(0,7);
  });
  room.stockCount=room.stock.length;
  room.currentTurn=room.players[0].id;
  room.firstTurn=true;
  io.to(code).emit("room_state",room);
}

function nextTurn(room){
  const idx=room.players.findIndex(p=>p.id===room.currentTurn);
  const nxt=room.players[(idx+1)%room.players.length];
  room.currentTurn=nxt.id;
}

function finishRound(code){
  const room=rooms[code];
  if(!room) return;
  const penalties={};
  room.players.forEach(p=>{
    penalties[p.id]=sumHand(room.hands[p.id]||[]);
  });
  // winner is lowest sum
  let winner=room.players[0].id, winScore=penalties[winner];
  for(const p of room.players){
    if(penalties[p.id]<winScore){ winner=p.id; winScore=penalties[p.id]; }
  }
  room.players.forEach(p=>{
    p.score=(p.score||0)+(p.id===winner?0:penalties[p.id]);
  });
  io.to(code).emit("showdown_summary",{hands:room.hands,results:{winner,penalties}});
}

function playBotMove(room,bot){
  if(room.currentTurn!==bot.id) return;

  const hand=room.hands[bot.id];
  if(!hand||!hand.length) return;

  // Discard: pick random 1 card (smarter with difficulty)
  let discard=[hand[Math.floor(Math.random()*hand.length)]];

  // remove from hand
  room.hands[bot.id]=hand.filter(c=>!discard.includes(c));
  // update discard pile
  room.discard.push(...discard);
  room.discardTop=discard[discard.length-1];

  // Draw: usually from stock
  if(room.stock.length){
    const drawn=room.stock.pop();
    room.hands[bot.id].push(drawn);
  }
  room.stockCount=room.stock.length;

  nextTurn(room);
}

/* ------------ Socket Events ------------ */
io.on("connection",socket=>{
  console.log("Client connected",socket.id);

  socket.on("create_room",(data,cb)=>{
    const code=Math.random().toString(36).substring(2,7).toUpperCase();
    rooms[code]={ code, hostId:socket.id, players:[], phase:"lobby", hands:{} };
    const player={ id:socket.id, name:data.name, isHost:true, score:0 };
    rooms[code].players.push(player);
    socket.join(code);
    cb({me:player,code});
    io.to(code).emit("room_state",rooms[code]);
  });

  socket.on("join_room",(data,cb)=>{
    const room=rooms[data.code];
    if(!room) return cb({error:"Room not found"});
    const player={ id:socket.id, name:data.name, score:0 };
    room.players.push(player);
    socket.join(data.code);
    cb({me:player,code:data.code});
    io.to(data.code).emit("room_state",room);
  });

  socket.on("start_game",(data)=>{
    startGame(data.code);
  });

  socket.on("discard",(data,cb)=>{
    const room=rooms[data.code]; if(!room) return;
    const hand=room.hands[socket.id];
    if(!hand) return;
    // remove discarded
    room.hands[socket.id]=hand.filter(h=>!data.cards.find(c=>c.suit===h.suit&&c.rank===h.rank));
    // update discard
    room.discard.push(...data.cards);
    room.discardTop=data.cards[data.cards.length-1];
    room.firstTurn=false;
    cb && cb();
    io.to(data.code).emit("room_state",room);
  });

  socket.on("draw",(data,cb)=>{
    const room=rooms[data.code]; if(!room) return;
    const hand=room.hands[socket.id];
    if(!hand) return;
    if(data.source==="stock" && room.stock.length){
      const c=room.stock.pop();
      hand.push(c);
    }else if(data.source==="discard" && room.discardTop){
      hand.push(room.discardTop);
      room.discardTop=null; // consumed
    }
    room.stockCount=room.stock.length;
    nextTurn(room);
    cb && cb();
    io.to(data.code).emit("room_state",room);
    // if next is bot
    const next=room.players.find(p=>p.id===room.currentTurn);
    if(next&&next.isBot) setTimeout(()=>{ playBotMove(room,next); io.to(data.code).emit("room_state",room); },1500);
  });

  socket.on("call_lakdi",(data)=>{
    const room=rooms[data.code]; if(!room) return;
    finishRound(data.code);
  });

  socket.on("next_round",(data)=> startGame(data.code));

  socket.on("single_player",(data,cb)=>{
    const code=Math.random().toString(36).substring(2,7).toUpperCase();
    rooms[code]={ code, hostId:socket.id, players:[], phase:"lobby", hands:{} };
    const me={ id:socket.id, name:data.name, isHost:true, score:0 };
    rooms[code].players.push(me);
    socket.join(code);

    for(let i=0;i<data.bots;i++){
      const bot={ id:`bot_${code}_${i}`, name:`Bot${i+1} (${data.difficulty})`, score:0, isBot:true };
      rooms[code].players.push(bot);
    }
    cb({me,code});
    io.to(code).emit("room_state",rooms[code]);
    startGame(code);
  });

  socket.on("disconnect",()=>{
    for(const code in rooms){
      const room=rooms[code];
      room.players=room.players.filter(p=>p.id!==socket.id);
      if(room.players.length===0) delete rooms[code];
      else io.to(code).emit("room_state",room);
    }
  });
});

server.listen(PORT,()=>console.log("Lakdi server running on",PORT));
