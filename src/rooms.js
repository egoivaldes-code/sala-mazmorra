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

/* Los pasos b) y c) reparten el presupuesto: primero un jefe si el dinero
   sobra de verdad, luego un puñado de gente cara (más en difícil, menos en
   normal), y por último rellena de esbirros. Si sobra dinero y no cabe ya
   ninguno más, cambia esbirros por algo mejor en vez de desperdiciarlo. */
function formarBanda(fam, dificultad, numHeroes){
  const cfg = board.DIFICULTADES[dificultad] || board.DIFICULTADES.normal;
  const inicial = cfg.base + cfg.porJugador * Math.max(numHeroes, 1);
  let presupuesto = inicial;

  const porRango = r => fam.datos.variantes.filter(v => (v.rango || 'esbirro') === r);
  const jefes = porRango('jefe'), grandes = porRango('grande'),
        apoyos = porRango('apoyo'), veteranos = porRango('veterano'),
        esbirros = porRango('esbirro');
  const coste = v => v.coste || 1;
  const elegir = lista => lista[Math.floor(Math.random()*lista.length)];
  const elegidos = [];

  // a) un jefe, sólo si sobra dinero de verdad: uno que se lleve todo el
  // presupuesto deja un duelo, no una banda
  if (jefes.length){
    const jefe = elegir(jefes);
    if (presupuesto >= coste(jefe) * 2){
      presupuesto -= coste(jefe);
      elegidos.push(jefe);
    }
  }

  // b) gente cara: en difícil hasta tres tipos distintos, en normal sólo uno
  const intentar = lista => {
    if (elegidos.length >= board.TOPE_FIGURAS || !lista.length) return false;
    const v = elegir(lista);
    if (presupuesto < coste(v)) return false;
    presupuesto -= coste(v);
    elegidos.push(v);
    return true;
  };
  if (dificultad === 'dificil'){
    intentar(apoyos); intentar(grandes); intentar(veteranos);
  } else if (!intentar(veteranos)){
    intentar(apoyos);
  }

  // c) rellena con esbirros hasta agotar el dinero o llegar al tope
  while (esbirros.length && elegidos.length < board.TOPE_FIGURAS){
    const v = elegir(esbirros);
    if (presupuesto < coste(v)) break;
    presupuesto -= coste(v);
    elegidos.push(v);
  }

  // d) si se llegó al tope y sobra dinero, no se tira: se cambia algún
  // esbirro por lo mejor que alcance. Más difícil = peores bichos, no sólo más.
  if (elegidos.length >= board.TOPE_FIGURAS && presupuesto > 0){
    const mejoras = [...apoyos, ...grandes, ...veteranos];
    let cambiado = true;
    while (cambiado && presupuesto > 0 && mejoras.length){
      cambiado = false;
      const i = elegidos.findIndex(v => (v.rango || 'esbirro') === 'esbirro');
      if (i < 0) break;
      const disponible = presupuesto + coste(elegidos[i]);
      const mejor = mejoras.filter(v => coste(v) <= disponible)
        .sort((a,b) => coste(b) - coste(a))[0];
      if (!mejor) break;
      presupuesto = disponible - coste(mejor);
      elegidos[i] = mejor;
      cambiado = true;
    }
  }

  return { elegidos, gasto: inicial - presupuesto };
}

/* Busca dónde colocar una pieza: recorre la mitad derecha del tablero de
   derecha a izquierda (los héroes entran por la izquierda), comprobando con
   despliegue() que cabe entera. */
function buscarSitio(room, pieza){
  const mitad = Math.floor(board.W / 2);
  for (let x = board.W - 1; x >= mitad; x--)
    for (let y = 0; y < board.H; y++){
      const celdas = despliegue(room, x, y, pieza.tam, pieza.id);
      if (celdas) return { x, y, celdas };
    }
  return null;
}

/* Forma la banda de la sala con el presupuesto de la dificultad elegida y el
   número de héroes en la mesa, y la coloca en el tablero. Se llama cada vez
   que cambia el número de héroes o la dificultad: se rehace desde cero. */
function poblar(room){
  room.enemigos = [];
  room.dificultad = room.dificultad || 'normal';
  const familias = catalog.state.catalogo.enemigos.filter(e => e.datos && e.datos.variantes);

  let fam;
  if (familias.length){
    // una sala = una familia. Da sensación de grupo en vez de feria de monstruos.
    fam = room.familia && familias.find(f => f.id === room.familia)
        || familias[Math.floor(Math.random()*familias.length)];
  } else {
    // contenido de reserva, por si la base no responde: cada bicho suelto hace de esbirro
    fam = { id:'reserva', nombre:'Reserva', datos:{ aro:'#B04E3C', base:{}, variantes:
      catalog.state.catalogo.enemigos.map(e => {
        const d = e.datos || {};
        return { papel:e.nombre, rango:'esbirro', coste:1,
                 vida:d.vida, velocidad:d.velocidad, dano:d.dano, tam:d.tam, ficha:d.ficha };
      }) } };
  }
  room.familia = fam.id;

  const { elegidos, gasto } = formarBanda(fam, room.dificultad, room.heroes.length);
  room.gasto = gasto;

  const base = fam.datos.base || {};
  const piezas = elegidos.map((v, i) => ({
    id: fam.id + '-' + i,
    tipo: fam.id,
    familia: fam.nombre,
    nombre: v.papel || fam.nombre,
    letra: (v.papel || fam.nombre)[0],
    aro: fam.datos.aro || '#B04E3C',
    ficha: v.ficha ? BASE_FICHAS + v.ficha : '',
    vida: v.vida || base.vida || 4,
    max:  v.vida || base.vida || 4,
    tam:  v.tam  || base.tam  || '1x1',
    rango: v.rango || 'esbirro',
    velocidad: v.velocidad || base.velocidad || 4,
    dano: v.dano || base.dano || [1,2]
  }));

  // las grandes van primero: si no, los esbirros les quitan el hueco
  const grandes = piezas.filter(p => { const m = board.medidas(p.tam); return m.an*m.al > 1; });
  const pequenas = piezas.filter(p => !grandes.includes(p));

  [...grandes, ...pequenas].forEach(pieza => {
    const sitio = buscarSitio(room, pieza);
    if (!sitio) return;
    pieza.x = sitio.x; pieza.y = sitio.y; pieza.celdas = sitio.celdas;
    room.enemigos.push(pieza);
  });
}

function makeRoom(){
  const code = newCode();
  // ronda 1 con turno de los héroes: así arranca cualquier sala nueva, antes de empezar la batalla
  const room = { code, players:new Map(), heroes:[], enemigos:[], created:Date.now(), ronda:1, turno:'heroes' };
  rooms.set(code, room);
  poblar(room);
  return code;
}

/* ocupado por un héroe vivo o por un enemigo, sin contar a "exceptId" (su propio id) */
function occupied(room, x, y, exceptId){
  for (const h of room.heroes)
    if (h.id !== exceptId && !h.caido && h.x===x && h.y===y) return true;
  for (const e of (room.enemigos||[])){
    if (e.id === exceptId) continue;
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
    // las personas conectadas, con su color y cuántos héroes llevan cada una
    jugadores: [...room.players.values()].map(p => ({
      token:p.token, name:p.name, color:p.color, hex:board.hexDe(p.color), online:p.online,
      heroes: room.heroes.filter(h => h.dueno === p.token).length
    })),
    // las fichas del tablero (se sigue llamando "players" para no romper las pantallas)
    players: room.heroes.map(h => {
      const dueno = room.players.get(h.dueno);
      return {
        id:h.id, token:h.dueno, name:h.nombre, cls:h.clsId, letter:h.letra,
        speed:h.speed, x:h.x, y:h.y, vida:h.vida, max:h.max, fat:h.fat, maxFat:h.maxFat,
        acciones:h.acciones, caido:h.caido, alcance:h.alcance, senala:h.senala || null,
        color: dueno ? dueno.color : 'hueso', hex: dueno ? board.hexDe(dueno.color) : board.hexDe('hueso'),
        online: dueno ? dueno.online : false
      };
    }),
    paleta: board.PALETA.map(c => ({ ...c, libre: board.colorLibre(room, c.id) })),
    dificultad: room.dificultad || 'normal',
    banda: { gasto: room.gasto || 0, heroes: room.heroes.length },
    familia: room.familia || null,
    enemigos: (room.enemigos||[]).map(e => ({
      id:e.id, nombre:e.nombre, familia:e.familia, letra:e.letra,
      aro:e.aro, ficha:e.ficha, vida:e.vida, max:e.max,
      x:e.x, y:e.y, tam:e.tam || '1x1', celdas:e.celdas || [[e.x,e.y]],
      // los nombres de los héroes que lo tienen señalado como objetivo ahora mismo
      senalan: room.heroes.filter(h => !h.caido && h.senala === e.id).map(h => h.nombre)
    })),
    taken: room.heroes.map(h => h.clsId)
  };
}

/* Hasta dónde puede llegar una unidad (héroe, o mañana un enemigo grande) en
   "pasos" casillas en cruz, esquivando muros y fichas.
   Al pasar sólo cuenta su casilla de referencia (regla de Descent); pero una
   casilla sólo entra en el resultado si despliegue() dice que ahí cabe entera. */
function alcanceDe(room, unidad, pasos){
  const seen = new Set([unidad.x+','+unidad.y]);
  const out = [];
  let frontier = [{x:unidad.x, y:unidad.y, c:0}];
  while (frontier.length){
    const n = frontier.shift();
    if (n.c > 0 && despliegue(room, n.x, n.y, unidad.tam, unidad.id))
      out.push({x:n.x, y:n.y, c:n.c});
    if (n.c === pasos) continue;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const nx = n.x+dx, ny = n.y+dy, k = nx+','+ny;
      if (!board.inBoard(nx,ny) || board.isWall(nx,ny)) continue;
      if (occupied(room,nx,ny,unidad.id)) continue;
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
          // sus héroes se quedan en el tablero, sólo se quedan sin dueño
          room.heroes.forEach(h => { if (h.dueno === t) h.dueno = null; });
        }
      if (room.players.size === 0 && now - room.created > GRACE) rooms.delete(code);
    }
  }, 60000);
}

module.exports = {
  rooms, GRACE, AVISO,
  makeRoom, occupied, freeStart, snapshot, alcanceDe, poblar,
  startCleanup
};
