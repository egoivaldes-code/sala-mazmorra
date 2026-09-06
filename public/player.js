var CLS = [];

fetch('/api/clases').then(function(r){ return r.json(); }).then(function(clases){
  CLS = clases;
  init();
});

function init(){
var s = io(), st = null, me = null, mode = false, pend = null;

/* el móvil te recuerda: llave guardada aquí */
var token;
try {
  token = localStorage.getItem('tk');
  if (!token){ token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('tk', token); }
} catch(e){ token = Math.random().toString(36).slice(2); }

var qs = new URLSearchParams(location.search);
var deQr = qs.get('s') ? qs.get('s').toUpperCase() : null;
if (deQr) document.getElementById('code').value = deQr;
try { if (localStorage.getItem('nm')) document.getElementById('name').value = localStorage.getItem('nm'); } catch(e){}

/* Si el QR trae una sala distinta a la guardada, manda el QR:
   quiere decir que la tele ha abierto otra partida. */
try {
  var guardada = localStorage.getItem('rm');
  if (deQr && guardada && deQr !== guardada) localStorage.removeItem('rm');
} catch(e){}

var salaActual = null;

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
  despierta(); // se pide al tocar: así los navegadores lo aceptan
  var code = document.getElementById('code').value.trim().toUpperCase();
  var name = document.getElementById('name').value.trim() || 'Jugador';
  try { localStorage.setItem('nm', name); localStorage.setItem('rm', code); } catch(e){}
  s.emit('join', { code:code, token:token, name:name }, function(r){
    if (!r.ok){ document.getElementById('e1').textContent = r.err; return; }
    salaActual = code;
    st = r.state; me = r.me;
    if (me.cls) show(3); else { heroList(); show(2); }
    render();
  });
};

/* volver solo si ya habías entrado antes y el QR no dice otra cosa */
try {
  var rm = localStorage.getItem('rm');
  if (rm) s.emit('join', { code:rm, token:token, name: localStorage.getItem('nm') || 'Jugador' },
    function(r){
      if (!r.ok){
        // la sala se cerró: se olvida y se pide el código otra vez
        try { localStorage.removeItem('rm'); } catch(e){}
        document.getElementById('e1').textContent = 'La partida anterior ya no existe. Escanea el QR otra vez.';
        return;
      }
      salaActual = rm;
      st = r.state; me = r.me;
      if (me.cls) show(3); else { heroList(); show(2); }
      render();
    });
} catch(e){}

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
  var vuelta = salaActual;
  if (!vuelta){ try { vuelta = localStorage.getItem('rm'); } catch(e){} }
  if (vuelta) s.emit('join', { code:vuelta, token:token, name: localStorage.getItem('nm') || 'Jugador' },
    function(r){ if (r.ok){ st = r.state; me = r.me; render(); } });
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
  (st.enemigos||[]).forEach(function(e){
    (e.celdas||[[e.x,e.y]]).forEach(function(c){ busy[c[0]+','+c[1]] = 1; });
  });
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
  (st.enemigos||[]).forEach(function(e){
    var cs = e.celdas || [[e.x,e.y]];
    var xs = cs.map(function(c){return c[0];}), ys = cs.map(function(c){return c[1];});
    var x0 = Math.min.apply(null,xs), y0 = Math.min.apply(null,ys);
    var anc = (Math.max.apply(null,xs)-x0+1), alt = (Math.max.apply(null,ys)-y0+1);
    if (e.senalan && e.senalan.length){
      var o = document.createElement('div');
      o.className = 'objetivo';
      o.style.left = (x0*cw)+'px'; o.style.top = (y0*ch)+'px';
      o.style.width = (anc*cw)+'px'; o.style.height = (alt*ch)+'px';
      b.appendChild(o);
    }
    var d = document.createElement('div');
    d.className = 'tok foe marca';
    d.textContent = e.letra;
    d.title = e.nombre;
    d.style.left = (x0*cw)+'px';
    d.style.top  = (y0*ch)+'px';
    d.style.width = (anc*cw)+'px'; d.style.height = (alt*ch)+'px';
    d.style.fontSize = Math.max(10, Math.min(anc*cw, alt*ch)*0.42)+'px';
    d.style.cursor = 'pointer';
    d.onclick = function(){ s.emit('senalar', e.id, function(){}); };
    b.appendChild(d);
  });
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
    : (function(){
        var mio = (st.enemigos||[]).filter(function(x){
          return x.senalan && x.senalan.indexOf(p.name) >= 0; })[0];
        return mio ? 'Señalas a ' + mio.nombre + '. Tócalo otra vez para soltarlo.'
                   : 'Toca un enemigo para señalarlo en la tele.';
      })();
}
window.addEventListener('resize', render);
}
