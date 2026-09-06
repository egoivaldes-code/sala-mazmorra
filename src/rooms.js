/* ---------- salas ---------- */
const board = require('./board');
const catalog = require('./catalog');
const { BASE_FICHAS } = require('./config');

const rooms = new Map();
const GRACE = 3 * 60 * 1000; // margen para volver si se cae el wifi
const AVISO = 20 * 1000;     // espera antes de decir a los demás que alguien se ha caído

function newCode(){
  let c;
  do { c = Math.random().toString(36).slice(2,6).toUpperCase(); }
  while (rooms.has(c));
  return c;
}

/* ¿Cabe desplegada aquí? Devuelve las casillas que ocuparía, o null. */
function despliegue(room, x, y, tam, quien){
  for (const celdas of board.colocaciones(x, y, tam))
    if (celdas.every(([cx,cy]) => !occupied(room, cx, cy, quien)))
      return celdas;
  return null;
}

/* Coloca en la sala un ejemplar de cada enemigo del catálogo.
   Todavía no se mueven: están para ver los cambios del editor al momento. */
function poblar(room){
  room.enemigos = [];
  const familias = catalog.state.catalogo.enemigos.filter(e => e.datos && e.datos.variantes);
  let piezas;

  if (familias.length){
    // una sala = una familia. Da sensación de grupo en vez de feria de monstruos.
    const fam = room.familia && familias.find(f => f.id === room.familia)
              || familias[Math.floor(Math.random()*familias.length)];
    room.familia = fam.id;
    const base = fam.datos.base || {};
    piezas = fam.datos.variantes.slice(0, board.SITIOS.length).map((v, i) => ({
      id: fam.id + '-' + i,
      tipo: fam.id,
      familia: fam.nombre,
      nombre: v.papel || fam.nombre,
      letra: (v.papel || fam.nombre)[0],
      aro: fam.datos.aro || '#B04E3C',
      ficha: v.ficha ? BASE_FICHAS + v.ficha : '',
      vida: v.vida || base.vida || 4,
      max:  v.vida || base.vida || 4,
      tam:  v.tam  || base.tam  || '1x1'
    }));
  } else {
    // contenido de reserva, por si la base no responde
    piezas = catalog.state.catalogo.enemigos.slice(0, board.SITIOS.length).map((e, i) => {
      const d = e.datos || {};
      return { id: e.id+'-'+i, tipo: e.id, familia: e.nombre, nombre: e.nombre,
               letra: d.letra || e.nombre[0], aro:'#B04E3C', ficha:'',
               vida: d.vida||1, max: d.vida||1, tam: d.tam||'1x1' };
    });
  }

  piezas.forEach((bicho, i) => {
    bicho.x = board.SITIOS[i][0]; bicho.y = board.SITIOS[i][1];
    let celdas = despliegue(room, bicho.x, bicho.y, bicho.tam, bicho.id);
    if (!celdas) celdas = buscarHueco(room, bicho);
    if (!celdas) return;
    bicho.celdas = celdas;
    room.enemigos.push(bicho);
  });
}

/* Si su sitio de siempre está ocupado, se le busca otro donde quepa entero.
   Se busca desde la derecha: los héroes entran por la izquierda. */
function buscarHueco(room, bicho){
  for (let x = board.W - 1; x >= 0; x--)
    for (let y = 0; y < board.H; y++){
      const celdas = despliegue(room, x, y, bicho.tam, bicho.id);
      if (celdas){ bicho.x = x; bicho.y = y; return celdas; }
    }
  return null;
}

function makeRoom(){
  const code = newCode();
  const room = { code, players:new Map(), enemigos:[], created:Date.now() };
  rooms.set(code, room);
  poblar(room);
  return code;
}

function occupied(room, x, y, exceptToken){
  for (const [t,p] of room.players)
    if (t !== exceptToken && p.cls && p.x===x && p.y===y) return true;
  for (const e of (room.enemigos||[])){
    if (e.id === exceptToken) continue;
    if ((e.celdas||[[e.x,e.y]]).some(c => c[0]===x && c[1]===y)) return true;
  }
  return false;
}

function freeStart(room){
  for (const [x,y] of board.START) if (!occupied(room,x,y,null)) return {x,y};
  for (let y=0;y<board.H;y++) for (let x=0;x<board.W;x++)
    if (!board.isWall(x,y) && !occupied(room,x,y,null)) return {x,y};
  return {x:0,y:0};
}

function snapshot(room){
  return {
    code: room.code,
    board: { w:board.W, h:board.H, walls:board.WALLS },
    players: [...room.players.values()]
      .filter(p => p.cls)
      .map(p => ({
        token:p.token, name:p.name, cls:p.cls.id, letter:p.cls.letter,
        speed:p.cls.speed, x:p.x, y:p.y, online:p.online, senala:p.senala || null
      })),
    familia: room.familia || null,
    enemigos: (room.enemigos||[]).map(e => ({
      id:e.id, nombre:e.nombre, familia:e.familia, letra:e.letra,
      aro:e.aro, ficha:e.ficha, vida:e.vida, max:e.max,
      x:e.x, y:e.y, tam:e.tam || '1x1', celdas:e.celdas || [[e.x,e.y]],
      // quién lo tiene señalado como objetivo ahora mismo
      senalan: [...room.players.values()].filter(p => p.cls && p.senala === e.id).map(p => p.name)
    })),
    taken: [...room.players.values()].filter(p=>p.cls).map(p=>p.cls.id)
  };
}

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
      if (!board.inBoard(nx,ny) || board.isWall(nx,ny)) continue;
      if (occupied(room,nx,ny,p.token)) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      frontier.push({x:nx, y:ny, c:n.c+1});
    }
  }
  return out;
}

/* limpieza de salas viejas */
function startCleanup(){
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms){
      for (const [t,p] of room.players)
        if (!p.online && now - p.left > GRACE){
          if (p.pending) clearTimeout(p.pending);
          room.players.delete(t);
        }
      if (room.players.size === 0 && now - room.created > GRACE) rooms.delete(code);
    }
  }, 60000);
}

module.exports = {
  rooms, GRACE, AVISO,
  makeRoom, occupied, freeStart, snapshot, reachable, poblar,
  startCleanup
};
