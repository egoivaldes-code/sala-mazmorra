/* ---------- catálogo de enemigos ---------- */
const { db, HAY_DB } = require('./config');

const RESERVA = [
  { id:'goblin', nombre:'Goblin', datos:{ letra:'g', vida:3, velocidad:5, dano:[1,2] } },
  { id:'orco',   nombre:'Orco',   datos:{ letra:'O', vida:8, velocidad:4, dano:[3,4] } }
];

/* Objeto mutable compartido: se reasigna entero al recargar desde la base,
   así que otros módulos deben leer siempre state.catalogo, nunca guardarlo aparte. */
const state = {
  catalogo: { enemigos: RESERVA.slice(), fuente:'reserva' },
  fallaDb: HAY_DB ? 'todavía no he leído la base' : 'no hay claves puestas'
};

async function cargarCatalogo(){
  if (!HAY_DB){ console.log('Sin base de datos: uso el contenido de reserva.'); return; }
  try {
    const filas = await db('enemigos?select=*&order=id');
    if (filas && filas.length){
      state.catalogo = { enemigos: filas, fuente:'base de datos' };
      state.fallaDb = null;
      console.log('Catálogo cargado: ' + filas.length + ' enemigos.');
    } else {
      state.fallaDb = 'la tabla de enemigos está vacía';
    }
  } catch(e){
    state.fallaDb = e.message;
    console.log('No he podido leer la base, sigo con la reserva. ' + e.message);
  }
}

async function guardarEnemigo(fila){
  if (!HAY_DB) throw new Error('No hay base de datos configurada.');
  await db('enemigos', {
    method:'POST',
    headers:{ Prefer:'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(fila)
  });
}

module.exports = { state, RESERVA, cargarCatalogo, guardarEnemigo };
