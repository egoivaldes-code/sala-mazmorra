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
  { id:'gue', name:'Guerrero', letter:'G', speed:3, vida:14, fatiga:2, alcance:1, dano:[3,5] },
  { id:'pal', name:'Paladín',  letter:'P', speed:3, vida:12, fatiga:3, alcance:1, dano:[3,5] },
  { id:'pic', name:'Pícaro',   letter:'Í', speed:5, vida:8,  fatiga:3, alcance:1, dano:[2,4] },
  { id:'arq', name:'Arquero',  letter:'A', speed:4, vida:9,  fatiga:3, alcance:6, dano:[2,4] },
  { id:'mag', name:'Mago',     letter:'M', speed:3, vida:8,  fatiga:4, alcance:4, dano:[3,4] },
  { id:'cle', name:'Clérigo',  letter:'C', speed:3, vida:10, fatiga:4, alcance:1, dano:[2,3] }
];
const START = [[0,4],[0,3],[0,5],[1,4],[1,3],[1,5]];
const SITIOS = [[10,1],[11,5],[9,7],[10,4],[11,1],[9,3]];

/* cada héroe puede hacer dos acciones por ronda (moverse, atacar...) */
const ACCIONES_POR_RONDA = 2;

/* colores para distinguir a los jugadores en la tele: uno por persona */
const PALETA = [
  { id:'ambar',     nombre:'Ámbar',     hex:'#D3A63C' },
  { id:'carmesi',   nombre:'Carmesí',   hex:'#C0483C' },
  { id:'esmeralda', nombre:'Esmeralda', hex:'#5B9E63' },
  { id:'azul',      nombre:'Azul',      hex:'#4A7FE0' },
  { id:'violeta',   nombre:'Violeta',   hex:'#8E6BC4' },
  { id:'turquesa',  nombre:'Turquesa',  hex:'#3FA6A0' },
  { id:'rosa',      nombre:'Rosa',      hex:'#D2679B' },
  { id:'hueso',     nombre:'Hueso',     hex:'#D9D2C2' }
];

function hexDe(id){
  const c = PALETA.find(c => c.id === id);
  return c ? c.hex : '';
}

/* ¿hay algún jugador de la sala llevando ya este color? */
function colorLibre(room, id){
  for (const p of room.players.values()) if (p.color === id) return false;
  return true;
}

/* el primer color de la paleta que todavía no lleva nadie en la sala */
function primerColorLibre(room){
  const libre = PALETA.find(c => colorLibre(room, c.id));
  return libre ? libre.id : PALETA[0].id;
}

/* ---------- figuras de varias casillas ----------
   Regla de Descent: al moverse, una figura grande sigue una sola casilla
   (su casilla de referencia). Sólo al terminar el movimiento tiene que caber
   desplegada. Si no cabe en ningún sitio, el movimiento entero es ilegal:
   nunca puede quedarse encajada a medias. */

function medidas(tam){
  const m = /^(\d+)x(\d+)$/.exec(tam || '1x1');
  return m ? { an: +m[1], al: +m[2] } : { an:1, al:1 };
}

/* Las colocaciones posibles de una figura cuya referencia está en (x,y).
   Las monturas (2x1) nunca giran: siempre en horizontal. */
function colocaciones(x, y, tam){
  const { an, al } = medidas(tam);
  const salida = [];
  for (let dx = 0; dx < an; dx++)
    for (let dy = 0; dy < al; dy++){
      const celdas = [];
      let vale = true;
      for (let i = 0; i < an && vale; i++)
        for (let j = 0; j < al && vale; j++){
          const cx = x - dx + i, cy = y - dy + j;
          if (!inBoard(cx, cy) || isWall(cx, cy)) vale = false;
          else celdas.push([cx, cy]);
        }
      if (vale) salida.push(celdas);
    }
  return salida;
}

module.exports = {
  W, H, WALLS, isWall, inBoard,
  CLASSES, START, SITIOS, ACCIONES_POR_RONDA,
  PALETA, hexDe, colorLibre, primerColorLibre,
  medidas, colocaciones
};
