/* ---------- configuración y acceso a la base de datos ----------
   Si no hay claves puestas, el juego funciona igual con el contenido de reserva.
   Así nunca se queda tirado por un fallo de la base. */

const PORT = process.env.PORT || 3000;

/* Admite que la dirección venga con barra final o con /rest/v1 ya incluido:
   los dos casos son fáciles de copiar mal desde el panel de Supabase. */
const DB_URL = (process.env.SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/, '');
const DB_KEY = (process.env.SUPABASE_KEY || '').trim();
const HAY_DB = !!(DB_URL && DB_KEY);
const CLAVE_EDITOR = process.env.EDITOR_PASS || '';
/* Las fichas viven en el almacén público de Supabase. */
const BASE_FICHAS = DB_URL ? DB_URL + '/storage/v1/object/public/fichas/' : '';

async function db(camino, opciones = {}){
  const r = await fetch(DB_URL + '/rest/v1/' + camino, {
    ...opciones,
    headers: {
      apikey: DB_KEY,
      Authorization: 'Bearer ' + DB_KEY,
      'Content-Type': 'application/json',
      ...(opciones.headers || {})
    }
  });
  if (!r.ok) throw new Error('base de datos: ' + r.status + ' ' + await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

module.exports = { PORT, DB_URL, DB_KEY, HAY_DB, CLAVE_EDITOR, BASE_FICHAS, db };
