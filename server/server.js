const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server,{cors:{origin:"*"}});

function makeDeck(){
  const suits=["hearts","diamonds","clubs","spades"];
  const ranks=["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
  return suits.flatMap(s=>ranks.map(r=>({suit:s,rank:r})));
}
function shuffle(arr){for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr;}

let rooms={};

io.on("connection",socket=>{
  socket.on("create_room",(data,cb)=>{
    const code=Math.random().toString(36).substr(2,5).toUpperCase();
    rooms[code]={code,players:[],stock:shuffle(makeDeck()),immediate:[],past:[],hands:{},phase:"discard",currentTurn:null};
    rooms[code].players.push({id:socket.id,name:data.name,score:0});
    rooms[code].hands[socket.id]=rooms[code].stock.splice(0,3);
    rooms[code].currentTurn=socket.id;
    socket.join(code);
    cb({code,me:{id:socket.id,name:data.name}});
    io.to(code).emit("room_state",rooms[code]);
  });
  socket.on("join_room",(data,cb)=>{
    const room=rooms[data.code];
    if(!room) return cb({error:"Invalid room"});
    room.players.push({id:socket.id,name:data.name,score:0});
    room.hands[socket.id]=room.stock.splice(0,3);
    socket.join(data.code);
    cb({code:data.code,me:{id:socket.id,name:data.name}});
    io.to(data.code).emit("room_state",room);
  });
  socket.on("single_player",(data,cb)=>{
    const code=socket.id;
    rooms[code]={code,players:[{id:socket.id,name:data.name,score:0},{id:"BOT",name:"Computer",score:0}],stock:shuffle(makeDeck()),immediate:[],past:[],hands:{},phase:"discard",currentTurn:socket.id};
    rooms[code].hands[socket.id]=rooms[code].stock.splice(0,3);
    rooms[code].hands["BOT"]=rooms[code].stock.splice(0,3);
    socket.join(code);
    cb({code,me:{id:socket.id,name:data.name}});
    io.to(code).emit("room_state",rooms[code]);
  });
  socket.on("discard",({code,idx},cb)=>{
    const r=rooms[code];if(!r) return;
    const mine=r.hands[socket.id];const cards=idx.map(i=>mine[i]);
    r.immediate=cards;idx.sort((a,b)=>b-a).forEach(i=>mine.splice(i,1));
    r.phase="draw";io.to(code).emit("room_state",r);cb&&cb();
  });
  socket.on("draw",({code,source},cb)=>{
    const r=rooms[code];if(!r) return;
    if(source==="stock"&&r.stock.length) r.hands[socket.id].push(r.stock.pop());
    else if(source==="past"&&r.past.length) r.hands[socket.id].push(r.past.pop());
    r.past=[...r.immediate];r.immediate=[];r.phase="discard";advanceTurn(r);io.to(code).emit("room_state",r);cb&&cb();
  });
  socket.on("call_lakdi",({code})=>{
    const r=rooms[code];if(!r) return;
    // simple showdown
    io.to(code).emit("showdown_summary",{players:r.players,hands:r.hands});
    r.phase="showdown";
  });
  socket.on("next_round",({code})=>{
    const r=rooms[code];if(!r) return;
    r.stock=shuffle(makeDeck());r.immediate=[];r.past=[];
    r.players.forEach(p=>r.hands[p.id]=r.stock.splice(0,3));
    r.phase="discard";r.currentTurn=r.players[0].id;
    io.to(code).emit("room_state",r);
  });
  socket.on("disconnect",()=>{});
});

function advanceTurn(r){
  const ids=r.players.map(p=>p.id);
  const idx=ids.indexOf(r.currentTurn);
  r.currentTurn=ids[(idx+1)%ids.length];
}

server.listen(3000,()=>console.log("Server running on 3000"));

