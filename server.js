/* Sala de mazmorra - prueba de sincronización
   Una sala, varios móviles, una tele. El servidor manda. */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

/* ---------- mundo ---------- */
const W = 12, H = 9;
const WALLS = [
  [4,1],[4,2],[4,3],
  [8,5],[8,6],[8,7],
  [2,6],[3,6],
  [9,2],[10,2]
];
const isWall = (x,y) => WALLS.some(w => w[0]===x && w[1]===y);
const inBoard = (x,y) => x>=0 && y>=0 && x<W && y<H;

const CLASSES = [
  { id:'gue', name:'Guerrero', letter:'G', speed:3 },
  { id:'bar', name:'Bárbaro',  letter:'B', speed:4 },
  { id:'pic', name:'Pícaro',   letter:'P', speed:5 },
  { id:'arq', name:'Arquero',  letter:'A', speed:4 },
  { id:'mag', name:'Mago',     letter:'M', speed:3 },
  { id:'cle', name:'Clérigo',  letter:'C', speed:3 }
];
const START = [[0,4],[0,3],[0,5],[1,4],[1,3],[1,5]];

/* ---------- salas ---------- */
const rooms = new Map();
const GRACE = 3 * 60 * 1000; // margen para volver si se cae el wifi

function newCode(){
  let c;
  do { c = Math.random().toString(36).slice(2,6).toUpperCase(); }
  while (rooms.has(c));
  return c;
}
function makeRoom(){
  const code = newCode();
  rooms.set(code, { code, players:new Map(), created:Date.now() });
  return code;
}
function occupied(room, x, y, exceptToken){
  for (const [t,p] of room.players)
    if (t !== exceptToken && p.cls && p.x===x && p.y===y) return true;
  return false;
}
function freeStart(room){
  for (const [x,y] of START) if (!occupied(room,x,y,null)) return {x,y};
  for (let y=0;y<H;y++) for (let x=0;x<W;x++)
    if (!isWall(x,y) && !occupied(room,x,y,null)) return {x,y};
  return {x:0,y:0};
}
function snapshot(room){
  return {
    code: room.code,
    board: { w:W, h:H, walls:WALLS },
    players: [...room.players.values()]
      .filter(p => p.cls)
      .map(p => ({
        token:p.token, name:p.name, cls:p.cls.id, letter:p.cls.letter,
        speed:p.cls.speed, x:p.x, y:p.y, online:p.online
      })),
    taken: [...room.players.values()].filter(p=>p.cls).map(p=>p.cls.id)
  };
}
const push = room => io.to(room.code).emit('state', snapshot(room));

/* distancia real esquivando muros y fichas */
function reachable(room, p){
  const seen = new Set([p.x+','+p.y]);
  const out = [];
  let frontier = [{x:p.x,y:p.y,c:0}];
  while (frontier.length){
    const n = frontier.shift();
    if (n.c > 0) out.push({x:n.x, y:n.y, c:n.c});
    if (n.c === p.cls.speed) continue;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = n.x+dx, ny = n.y+dy, k = nx+','+ny;
      if (!inBoard(nx,ny) || isWall(nx,ny)) continue;
      if (occupied(room,nx,ny,p.token)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      frontier.push({x:nx, y:ny, c:n.c+1});
    }
  }
  return out;
}

/* limpieza de salas viejas */
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms){
    for (const [t,p] of room.players)
      if (!p.online && now - p.left > GRACE) room.players.delete(t);
    if (room.players.size === 0 && now - room.created > GRACE) rooms.delete(code);
  }
}, 60000);

/* ---------- conexiones ---------- */
io.on('connection', socket => {

  socket.on('tv:open', (_, cb) => {
    const code = makeRoom();
    socket.join(code);
    socket.data.code = code;
    socket.data.isTv = true;
    cb({ ok:true, state: snapshot(rooms.get(code)) });
  });

  socket.on('tv:rejoin', (code, cb) => {
    const room = rooms.get(code);
    if (!room) return cb({ ok:false, err:'Esa sala ya no existe.' });
    socket.join(code);
    socket.data.code = code;
    socket.data.isTv = true;
    cb({ ok:true, state: snapshot(room) });
  });

  socket.on('join', ({ code, token, name }, cb) => {
    code = (code||'').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return cb({ ok:false, err:'No encuentro esa sala. Revisa el código.' });

    let p = room.players.get(token);
    if (p){
      p.online = true;
      p.name = name || p.name;
    } else {
      if (room.players.size >= 6) return cb({ ok:false, err:'La sala está llena.' });
      p = { token, name: name || 'Jugador', cls:null, x:0, y:0, online:true, left:0 };
      room.players.set(token, p);
    }
    socket.join(code);
    socket.data.code = code;
    socket.data.token = token;
    push(room);
    cb({ ok:true, state: snapshot(room), me:{ token, cls: p.cls ? p.cls.id : null } });
  });

  socket.on('pick', (clsId, cb) => {
    const room = rooms.get(socket.data.code);
    if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
    const p = room.players.get(socket.data.token);
    if (!p) return cb && cb({ ok:false, err:'No estás en la sala.' });
    if (p.cls) return cb && cb({ ok:false, err:'Ya tienes héroe.' });
    const taken = [...room.players.values()].some(o => o.cls && o.cls.id === clsId);
    if (taken) return cb && cb({ ok:false, err:'Ese héroe lo ha cogido otro.' });
    const cls = CLASSES.find(c => c.id === clsId);
    if (!cls) return cb && cb({ ok:false, err:'Héroe desconocido.' });
    const spot = freeStart(room);
    p.cls = cls; p.x = spot.x; p.y = spot.y;
    push(room);
    cb && cb({ ok:true, cls:clsId });
  });

  socket.on('move', ({ x, y }, cb) => {
    const room = rooms.get(socket.data.code);
    if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
    const p = room.players.get(socket.data.token);
    if (!p || !p.cls) return cb && cb({ ok:false, err:'Todavía no tienes héroe.' });
    // el servidor decide: no se fía de lo que diga el móvil
    const ok = reachable(room, p).some(c => c.x === x && c.y === y);
    if (!ok) return cb && cb({ ok:false, err:'No llegas ahí.' });
    p.x = x; p.y = y;
    push(room);
    cb && cb({ ok:true });
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.code);
    if (!room || socket.data.isTv) return;
    const p = room.players.get(socket.data.token);
    if (p){ p.online = false; p.left = Date.now(); push(room); }
  });
});

/* ---------- estilos comunes ---------- */
const CSS = `
:root{--stone:#161B21;--stone2:#212932;--wall:#39434F;--floor:#1C232B;
--parchment:#E9E3D5;--dim:#8A94A0;--brass:#D3A63C;--moss:#6E9163;--teal:#4E8288;
--line:rgba(233,227,213,.10);--serif:Spectral,Georgia,serif;
--sans:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:#0D1116;color:var(--parchment);font-family:var(--sans)}
.board{position:relative;background:var(--floor);border:1px solid var(--wall);
border-radius:3px;overflow:hidden}
.cell{position:absolute;border-right:1px solid rgba(0,0,0,.35);
border-bottom:1px solid rgba(0,0,0,.35)}
.cell.wall{background:var(--wall)}
.tok{position:absolute;display:flex;align-items:center;justify-content:center;
border-radius:50%;font-family:var(--serif);font-weight:600;
background:#2E3742;border:2px solid var(--brass);color:var(--brass);
transition:left .18s ease,top .18s ease}
.tok.me{box-shadow:0 0 0 3px rgba(211,166,60,.3)}
.tok.off{opacity:.35;border-style:dashed}
.dot{position:absolute;border-radius:50%;background:rgba(110,145,99,.3);
border:2px solid var(--moss);cursor:pointer}
.dot.sel{background:rgba(211,166,60,.34);border-color:var(--brass)}
button{font-family:var(--serif);cursor:pointer}
:focus-visible{outline:2px solid var(--brass);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.tok{transition:none}}
`;

/* ---------- pantalla de la tele ---------- */
const TV = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mazmorra - Tele</title>
<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}
body{display:flex;align-items:center;justify-content:center;height:100dvh;padding:20px}
.wrap{display:flex;gap:26px;align-items:center;width:100%;max-width:1500px}
.left{flex:1;min-width:0}
.side{width:280px;flex-shrink:0}
.board{width:100%;aspect-ratio:12/9}
h1{font-family:var(--serif);font-size:19px;font-weight:600;margin:0 0 6px}
.code{font-family:var(--serif);font-size:52px;letter-spacing:.12em;color:var(--brass);margin:2px 0 10px}
.url{font-size:13px;color:var(--dim);word-break:break-all;margin-bottom:14px}
.qr{background:#E9E3D5;padding:9px;border-radius:4px;width:190px;height:190px;margin-bottom:16px}
.qr img{width:100%;height:100%;display:block}
.pl{display:flex;align-items:center;gap:9px;padding:7px 0;border-top:1px solid var(--line);font-size:14px}
.pl b{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;
background:#2E3742;border:1px solid var(--brass);color:var(--brass);font-family:var(--serif);font-size:13px}
.pl s{margin-left:auto;color:var(--dim);font-size:12px;text-decoration:none}
.empty{color:var(--dim);font-size:14px;padding:10px 0}
</style></head><body>
<div class="wrap">
  <div class="left"><div class="board" id="b"></div></div>
  <div class="side">
    <h1>Entrad desde el móvil</h1>
    <div class="code" id="code">····</div>
    <div class="url" id="url"></div>
    <div class="qr"><img id="qr" alt="Código QR para entrar"></div>
    <div id="list"><div class="empty">Nadie ha entrado todavía.</div></div>
  </div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
var s = io(), st = null;
var saved = null;
try { saved = sessionStorage.getItem('tvcode'); } catch(e){}
function opened(r){
  if(!r.ok){ try{ sessionStorage.removeItem('tvcode'); }catch(e){} location.reload(); return; }
  st = r.state;
  try { sessionStorage.setItem('tvcode', st.code); } catch(e){}
  var u = location.origin + '/?s=' + st.code;
  document.getElementById('code').textContent = st.code;
  document.getElementById('url').textContent = u;
  document.getElementById('qr').src =
    'https://api.qrserver.com/v1/create-qr-code/?size=380x380&margin=0&data=' + encodeURIComponent(u);
  draw();
}
if (saved) s.emit('tv:rejoin', saved, opened); else s.emit('tv:open', null, opened);
s.on('state', function(x){ st = x; draw(); });

function draw(){
  if(!st) return;
  var b = document.getElementById('b');
  var cw = b.clientWidth / st.board.w, ch = b.clientHeight / st.board.h;
  b.innerHTML = '';
  for (var y=0; y<st.board.h; y++) for (var x=0; x<st.board.w; x++){
    var wall = st.board.walls.some(function(w){ return w[0]===x && w[1]===y; });
    var c = document.createElement('div');
    c.className = 'cell' + (wall ? ' wall' : '');
    c.style.left=(x*cw)+'px'; c.style.top=(y*ch)+'px';
    c.style.width=cw+'px'; c.style.height=ch+'px';
    b.appendChild(c);
  }
  var sz = Math.min(cw,ch)*0.74;
  st.players.forEach(function(p){
    var d = document.createElement('div');
    d.className = 'tok' + (p.online ? '' : ' off');
    d.textContent = p.letter;
    d.style.left = (p.x*cw + (cw-sz)/2)+'px';
    d.style.top  = (p.y*ch + (ch-sz)/2)+'px';
    d.style.width = sz+'px'; d.style.height = sz+'px';
    d.style.fontSize = Math.max(12, sz*0.42)+'px';
    b.appendChild(d);
  });
  var l = document.getElementById('list');
  if (!st.players.length){ l.innerHTML = '<div class="empty">Nadie ha entrado todavía.</div>'; return; }
  l.innerHTML = st.players.map(function(p){
    return '<div class="pl"><b>'+p.letter+'</b>'+p.name+
      '<s>'+(p.online?'':'sin conexión')+'</s></div>';
  }).join('');
}
window.addEventListener('resize', draw);
</script></body></html>`;

/* ---------- pantalla del jugador ---------- */
const PLAYER = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>Mazmorra</title>
<link href="https://fonts.googleapis.com/css2?family=Spectral:wght@400;600&display=swap" rel="stylesheet">
<style>${CSS}
body{display:flex;justify-content:center;min-height:100dvh}
.app{width:100%;max-width:440px;background:var(--stone);padding:14px;
display:flex;flex-direction:column;min-height:100dvh}
h1{font-family:var(--serif);font-size:18px;font-weight:600;margin:0 0 3px}
p.sub{color:var(--dim);font-size:13px;margin:0 0 16px;line-height:1.4}
input{width:100%;padding:14px;margin-bottom:9px;background:var(--stone2);
border:1px solid var(--line);border-radius:4px;color:var(--parchment);
font-family:var(--serif);font-size:17px}
input#code{letter-spacing:.22em;text-transform:uppercase;text-align:center}
.big{width:100%;padding:15px;background:var(--brass);color:#1A1408;border:0;
border-radius:4px;font-size:16px;font-weight:600}
.big[disabled]{opacity:.4}
.err{color:#E08C7A;font-size:13px;min-height:18px;margin:8px 0 0}
.heroes{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.hero{padding:16px 8px;background:var(--stone2);border:1px solid var(--line);
border-radius:4px;color:var(--parchment);font-size:15px;font-weight:600}
.hero small{display:block;color:var(--dim);font-weight:400;font-size:11px;
margin-top:3px;font-family:var(--sans)}
.hero[disabled]{opacity:.3}
.board{width:100%;aspect-ratio:12/9;margin-bottom:12px}
.who{display:flex;align-items:center;gap:9px;margin-bottom:10px}
.who b{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;
justify-content:center;background:#2E3742;border:2px solid var(--brass);
color:var(--brass);font-family:var(--serif)}
.who span{font-family:var(--serif);font-size:15px}
.who i{margin-left:auto;color:var(--dim);font-size:11.5px;font-style:normal}
.hint{color:var(--dim);font-size:12.5px;min-height:17px;margin:0 0 8px;line-height:1.35}
.verb{width:100%;padding:17px;background:var(--stone2);border:1px solid var(--line);
border-radius:4px;color:var(--parchment);font-size:16px;font-weight:600}
.verb[aria-pressed="true"]{background:var(--brass);color:#1A1408;border-color:var(--brass)}
.row{display:flex;gap:8px;margin-top:8px}
.row button{flex:1;padding:15px;border-radius:4px;font-size:15px;font-weight:600;
border:1px solid var(--line)}
.go{background:var(--brass);color:#1A1408;border-color:var(--brass)}
.back{background:transparent;color:var(--dim)}
.hide{display:none}
</style></head><body>
<div class="app">
  <div id="s1">
    <h1>Entrar en la partida</h1>
    <p class="sub">Escribe el código que sale en la tele.</p>
    <input id="code" maxlength="4" placeholder="CÓDIGO" autocomplete="off">
    <input id="name" maxlength="14" placeholder="Tu nombre" autocomplete="off">
    <button class="big" id="enter">Entrar</button>
    <p class="err" id="e1"></p>
  </div>

  <div id="s2" class="hide">
    <h1>Elige héroe</h1>
    <p class="sub">Cada uno lleva uno distinto.</p>
    <div class="heroes" id="heroes"></div>
    <p class="err" id="e2"></p>
  </div>

  <div id="s3" class="hide">
    <div class="who"><b id="ltr"></b><span id="nm"></span><i id="conn"></i></div>
    <div class="board" id="b"></div>
    <p class="hint" id="hint"></p>
    <button class="verb" id="mv">Mover</button>
    <div class="row hide" id="cf">
      <button class="back" id="bk">Atrás</button>
      <button class="go" id="ok">Confirmar</button>
    </div>
  </div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
var s = io(), st = null, me = null, mode = false, pend = null;

/* el móvil te recuerda: llave guardada aquí */
var token;
try {
  token = localStorage.getItem('tk');
  if (!token){ token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('tk', token); }
} catch(e){ token = Math.random().toString(36).slice(2); }

var qs = new URLSearchParams(location.search);
if (qs.get('s')) document.getElementById('code').value = qs.get('s').toUpperCase();
try { if (localStorage.getItem('nm')) document.getElementById('name').value = localStorage.getItem('nm'); } catch(e){}

function show(n){
  ['s1','s2','s3'].forEach(function(id, i){
    document.getElementById(id).className = (i === n-1) ? '' : 'hide';
  });
}
function myPlayer(){
  if (!st) return null;
  for (var i=0;i<st.players.length;i++) if (st.players[i].token === token) return st.players[i];
  return null;
}

document.getElementById('enter').onclick = function(){
  var code = document.getElementById('code').value.trim().toUpperCase();
  var name = document.getElementById('name').value.trim() || 'Jugador';
  try { localStorage.setItem('nm', name); localStorage.setItem('rm', code); } catch(e){}
  s.emit('join', { code:code, token:token, name:name }, function(r){
    if (!r.ok){ document.getElementById('e1').textContent = r.err; return; }
    st = r.state; me = r.me;
    if (me.cls) show(3); else { heroList(); show(2); }
    render();
  });
};

/* volver solo si ya habías entrado antes */
try {
  var rm = localStorage.getItem('rm');
  if (rm) s.emit('join', { code:rm, token:token, name: localStorage.getItem('nm') || 'Jugador' },
    function(r){
      if (!r.ok) return;
      st = r.state; me = r.me;
      if (me.cls) show(3); else { heroList(); show(2); }
      render();
    });
} catch(e){}

var CLS = ${JSON.stringify(CLASSES)};
function heroList(){
  var box = document.getElementById('heroes');
  box.innerHTML = '';
  CLS.forEach(function(c){
    var taken = st && st.taken.indexOf(c.id) >= 0;
    var btn = document.createElement('button');
    btn.className = 'hero'; btn.disabled = taken;
    btn.innerHTML = c.name + '<small>' + (taken ? 'ya cogido' : 'velocidad ' + c.speed) + '</small>';
    btn.onclick = function(){
      s.emit('pick', c.id, function(r){
        if (!r.ok){ document.getElementById('e2').textContent = r.err; heroList(); return; }
        me.cls = c.id; show(3); render();
      });
    };
    box.appendChild(btn);
  });
}

s.on('state', function(x){
  st = x;
  if (document.getElementById('s2').className === '') heroList();
  render();
});
s.on('disconnect', function(){ document.getElementById('conn').textContent = 'sin conexión'; });
s.on('connect', function(){
  document.getElementById('conn').textContent = '';
  try {
    var rm = localStorage.getItem('rm');
    if (rm) s.emit('join', { code:rm, token:token, name: localStorage.getItem('nm') || 'Jugador' },
      function(r){ if (r.ok){ st = r.state; me = r.me; render(); } });
  } catch(e){}
});

document.getElementById('mv').onclick = function(){ mode = !mode; pend = null; render(); };
document.getElementById('bk').onclick = function(){ pend = null; render(); };
document.getElementById('ok').onclick = function(){
  s.emit('move', { x:pend.x, y:pend.y }, function(r){
    if (!r.ok) document.getElementById('hint').textContent = r.err;
    pend = null; mode = false; render();
  });
};

function reach(p){
  var seen = {}, out = [], q = [{x:p.x,y:p.y,c:0}];
  seen[p.x+','+p.y] = 1;
  var busy = {};
  st.players.forEach(function(o){ if (o.token !== p.token) busy[o.x+','+o.y] = 1; });
  while (q.length){
    var n = q.shift();
    if (n.c > 0) out.push({x:n.x, y:n.y});
    if (n.c === p.speed) continue;
    var d = [[1,0],[-1,0],[0,1],[0,-1]];
    for (var i=0;i<4;i++){
      var nx = n.x+d[i][0], ny = n.y+d[i][1], k = nx+','+ny;
      if (nx<0||ny<0||nx>=st.board.w||ny>=st.board.h) continue;
      if (st.board.walls.some(function(w){ return w[0]===nx && w[1]===ny; })) continue;
      if (busy[k] || seen[k]) continue;
      seen[k] = 1; q.push({x:nx, y:ny, c:n.c+1});
    }
  }
  return out;
}

function render(){
  if (!st) return;
  var p = myPlayer();
  if (!p) return;
  document.getElementById('ltr').textContent = p.letter;
  document.getElementById('nm').textContent = p.name + ' · ' + CLS.filter(function(c){
    return c.id === p.cls; })[0].name;

  var b = document.getElementById('b');
  var cw = b.clientWidth / st.board.w, ch = b.clientHeight / st.board.h;
  b.innerHTML = '';
  for (var y=0; y<st.board.h; y++) for (var x=0; x<st.board.w; x++){
    var wall = st.board.walls.some(function(w){ return w[0]===x && w[1]===y; });
    var c = document.createElement('div');
    c.className = 'cell' + (wall ? ' wall' : '');
    c.style.left=(x*cw)+'px'; c.style.top=(y*ch)+'px';
    c.style.width=cw+'px'; c.style.height=ch+'px';
    b.appendChild(c);
  }
  var sz = Math.min(cw,ch)*0.74;
  st.players.forEach(function(o){
    var d = document.createElement('div');
    d.className = 'tok' + (o.token === token ? ' me' : '') + (o.online ? '' : ' off');
    d.textContent = o.letter;
    d.style.left = (o.x*cw + (cw-sz)/2)+'px';
    d.style.top  = (o.y*ch + (ch-sz)/2)+'px';
    d.style.width = sz+'px'; d.style.height = sz+'px';
    d.style.fontSize = Math.max(11, sz*0.44)+'px';
    b.appendChild(d);
  });

  if (mode){
    var ds = Math.min(cw,ch)*0.64;
    reach(p).forEach(function(c){
      var sel = pend && pend.x === c.x && pend.y === c.y;
      var d = document.createElement('div');
      d.className = 'dot' + (sel ? ' sel' : '');
      d.style.left = (c.x*cw + (cw-ds)/2)+'px';
      d.style.top  = (c.y*ch + (ch-ds)/2)+'px';
      d.style.width = ds+'px'; d.style.height = ds+'px';
      d.onclick = function(){ pend = {x:c.x, y:c.y}; render(); };
      b.appendChild(d);
    });
  }

  document.getElementById('mv').setAttribute('aria-pressed', mode);
  document.getElementById('cf').className = pend ? 'row' : 'row hide';
  document.getElementById('hint').textContent = mode
    ? 'Toca a dónde quieres ir. Puedes moverte ' + p.speed + ' casillas.'
    : 'Muévete cuando quieras. Los demás lo ven en la tele.';
}
window.addEventListener('resize', render);
</script></body></html>`;

app.get('/tv', (_, res) => res.type('html').send(TV));
app.get('/', (_, res) => res.type('html').send(PLAYER));
app.get('/salud', (_, res) => res.json({ ok:true, salas: rooms.size }));

server.listen(PORT, () => console.log('En marcha en el puerto ' + PORT));
