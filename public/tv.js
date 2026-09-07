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
document.getElementById('difNormal').onclick = function(){ s.emit('tv:dificultad', 'normal', function(){}); };
document.getElementById('difDificil').onclick = function(){ s.emit('tv:dificultad', 'dificil', function(){}); };
s.on('state', function(x){ st = x; draw(); });

function draw(){
  if(!st) return;
  var b = document.getElementById('b');
  var cw = b.clientWidth / st.board.w, ch = b.clientHeight / st.board.h;
  b.innerHTML = '';
  actualizaTiradas(cw, ch);
  for (var y=0; y<st.board.h; y++) for (var x=0; x<st.board.w; x++){
    var wall = st.board.walls.some(function(w){ return w[0]===x && w[1]===y; });
    var c = document.createElement('div');
    c.className = 'cell' + (wall ? ' wall' : '');
    c.style.left=(x*cw)+'px'; c.style.top=(y*ch)+'px';
    c.style.width=cw+'px'; c.style.height=ch+'px';
    b.appendChild(c);
  }
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
    n.textContent = e.nombre + ' (' + e.vida + '/' + e.max + ')' +
      ((e.senalan && e.senalan.length) ? ' ← ' + e.senalan.join(', ') : '');
    if (e.senalan && e.senalan.length) n.style.opacity = '1';
    n.style.left = (x0*cw + anc*cw/2)+'px';
    n.style.top  = (y0*ch + alt*ch + 1)+'px';
    b.appendChild(n);
  });
  st.players.forEach(function(p){
    var d = document.createElement('div');
    d.className = 'tok jugador' + (p.online ? '' : ' off');
    d.textContent = p.letter;
    d.style.left = (p.x*cw)+'px';
    d.style.top  = (p.y*ch)+'px';
    d.style.width = cw+'px'; d.style.height = ch+'px';
    d.style.fontSize = Math.max(12, Math.min(cw,ch)*0.42)+'px';
    d.style.borderColor = p.hex;
    d.style.background = hexConAlpha(p.hex, 0.24);
    d.style.color = p.hex;
    b.appendChild(d);
    var np = document.createElement('div');
    np.className = 'nombrecito';
    np.textContent = p.name;
    np.style.left = (p.x*cw + cw/2)+'px';
    np.style.top  = (p.y*ch + ch + 1)+'px';
    b.appendChild(np);
  });
  var l = document.getElementById('list');
  if (!st.jugadores.length) l.innerHTML = '<div class="empty">Nadie ha entrado todavía.</div>';
  else l.innerHTML = st.jugadores.map(function(p){
    return '<div class="pl"><b style="background:'+p.hex+';border-color:'+p.hex+'"></b>'+p.name+
      ' <span style="color:var(--dim);font-size:11px">('+p.heroes+' héroe'+(p.heroes===1?'':'s')+')</span>' +
      '<s>'+(p.online?'':'sin conexión')+'</s></div>';
  }).join('');

  document.getElementById('difNormal').setAttribute('aria-pressed', st.dificultad === 'normal');
  document.getElementById('difDificil').setAttribute('aria-pressed', st.dificultad === 'dificil');
  var banda = st.banda || { gasto:0, heroes:0 };
  document.getElementById('banda').textContent =
    (st.enemigos||[]).length + ' enemigos · ' + banda.gasto + ' puntos de banda · ' + banda.heroes + ' héroes';

  var turnoTexto = st.fin === 'victoria' ? '¡Victoria! La banda ha caído.'
    : st.fin === 'derrota' ? 'Derrota. Todos los héroes han caído.'
    : 'Ronda ' + st.ronda + ' · Turno de ' + (st.turno === 'heroes' ? 'los héroes' : 'los enemigos');
  var relato = (st.relato || []).map(function(f){ return '<div>' + f + '</div>'; }).join('');
  document.getElementById('estado').innerHTML =
    '<div class="turnoinfo">' + turnoTexto + '</div>' + '<div class="relato">' + relato + '</div>';
}
window.addEventListener('resize', draw);

/* ---------- tiradas de dados ----------
   Cada tirada trae su propio "ts": si cambió desde la última vez que la
   vimos, es nueva y hay que animarla. Cada ficha lleva su temporizador
   aparte, así que las tiradas de fichas distintas se ven a la vez, nunca
   en cola: con 6 héroes y 2 acciones son 12 tiradas por ronda. */
var vistas = {};
var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var SIMBOLOS = { fallo:'✕', impacto:'⚔', critico:'⚔⚔' };

function actualizaTiradas(cw, ch){
  var lista = [];
  (st.players||[]).forEach(function(h){
    if (h.ultimaTirada) lista.push({ id:'h:'+h.id, t:h.ultimaTirada, x:h.x, y:h.y, anc:1, alt:1 });
  });
  (st.enemigos||[]).forEach(function(e){
    if (!e.ultimaTirada) return;
    var cs = e.celdas || [[e.x,e.y]];
    var xs = cs.map(function(c){return c[0];}), ys = cs.map(function(c){return c[1];});
    var x0 = Math.min.apply(null,xs), y0 = Math.min.apply(null,ys);
    lista.push({ id:'e:'+e.id, t:e.ultimaTirada,
      x:x0, y:y0, anc:(Math.max.apply(null,xs)-x0+1), alt:(Math.max.apply(null,ys)-y0+1) });
  });
  lista.forEach(function(u){
    if (vistas[u.id] === u.t.ts) return;
    vistas[u.id] = u.t.ts;
    mostrarTirada(u, cw, ch);
  });
}

function mostrarTirada(u, cw, ch){
  var capa = document.getElementById('dados');
  if (!capa) return;
  var caja = document.createElement('div');
  caja.className = 'tirada' + (reduceMotion ? ' directa' : '');
  caja.style.left = (u.x*cw + (u.anc*cw)/2) + 'px';
  caja.style.top = (u.y*ch) + 'px';

  if (u.t.rojo){
    var r = document.createElement('div');
    r.className = 'dado rojo';
    r.textContent = SIMBOLOS[u.t.rojo] || '?';
    caja.appendChild(r);
  }
  (u.t.dados||[]).forEach(function(n){
    var d = document.createElement('div');
    d.className = 'dado blanco' + (u.t.resultado === 'fallo' ? ' apagado' : '');
    d.textContent = n;
    caja.appendChild(d);
  });

  capa.appendChild(caja);
  setTimeout(function(){ if (caja.parentNode) caja.parentNode.removeChild(caja); }, 850);
}

/* pasa un "#rrggbb" a "rgba(r,g,b,alfa)", para pintar el relleno de la casilla del héroe */
function hexConAlpha(hex, alfa){
  var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  var r = parseInt(m[1],16), g = parseInt(m[2],16), bl = parseInt(m[3],16);
  return 'rgba(' + r + ',' + g + ',' + bl + ',' + alfa + ')';
}
