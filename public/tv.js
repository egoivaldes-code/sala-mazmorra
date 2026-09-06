despierta();
var s = io(), st = null;
var saved = null;
try { saved = localStorage.getItem('tvcode'); } catch(e){}
function opened(r){
  if(!r.ok){ try{ localStorage.removeItem('tvcode'); }catch(e){} location.reload(); return; }
  st = r.state;
  try { localStorage.setItem('tvcode', st.code); } catch(e){}
  var u = location.origin + '/?s=' + st.code;
  document.getElementById('code').textContent = st.code;
  document.getElementById('url').textContent = u;
  document.getElementById('qr').src =
    'https://api.qrserver.com/v1/create-qr-code/?size=380x380&margin=0&data=' + encodeURIComponent(u);
  draw();
}
if (saved) s.emit('tv:rejoin', saved, opened); else s.emit('tv:open', null, opened);
document.getElementById('nueva').onclick = function(){
  try { localStorage.removeItem('tvcode'); } catch(e){}
  location.reload();
};
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
    d.className = 'tok foe' + (e.ficha ? ' conficha' : '');
    d.textContent = e.letra;
    d.title = e.nombre + ' - ' + (e.familia||'') + ' (' + (e.tam||'1x1') + ')';
    d.style.left = (x0*cw)+'px';
    d.style.top  = (y0*ch)+'px';
    d.style.width = (anc*cw)+'px'; d.style.height = (alt*ch)+'px';
    d.style.fontSize = Math.max(12, Math.min(anc*cw, alt*ch)*0.4)+'px';
    if (e.ficha) d.style.backgroundImage = 'url(' + e.ficha + ')';
    b.appendChild(d);
    var n = document.createElement('div');
    n.className = 'nombrecito';
    n.textContent = (e.senalan && e.senalan.length)
      ? e.nombre + ' ← ' + e.senalan.join(', ')
      : e.nombre;
    if (e.senalan && e.senalan.length) n.style.opacity = '1';
    n.style.left = (x0*cw + anc*cw/2)+'px';
    n.style.top  = (y0*ch + alt*ch + 1)+'px';
    b.appendChild(n);
  });
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
