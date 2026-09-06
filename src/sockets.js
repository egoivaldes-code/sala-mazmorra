/* ---------- conexiones ---------- */
const board = require('./board');
const config = require('./config');
const catalog = require('./catalog');
const rooms = require('./rooms');

function registerSockets(io){
  const push = room => io.to(room.code).emit('state', rooms.snapshot(room));

  io.on('connection', socket => {

    socket.on('tv:open', (_, cb) => {
      const code = rooms.makeRoom();
      socket.join(code);
      socket.data.code = code;
      socket.data.isTv = true;
      cb({ ok:true, state: rooms.snapshot(rooms.rooms.get(code)) });
    });

    socket.on('tv:rejoin', (code, cb) => {
      const room = rooms.rooms.get(code);
      if (!room) return cb({ ok:false, err:'Esa sala ya no existe.' });
      socket.join(code);
      socket.data.code = code;
      socket.data.isTv = true;
      cb({ ok:true, state: rooms.snapshot(room) });
    });

    socket.on('join', ({ code, token, name }, cb) => {
      code = (code||'').trim().toUpperCase();
      const room = rooms.rooms.get(code);
      if (!room) return cb({ ok:false, err:'No encuentro esa sala. Revisa el código.' });

      let p = room.players.get(token);
      if (p){
        // ha vuelto: si había un aviso de desconexión en camino, se cancela
        if (p.pending){ clearTimeout(p.pending); p.pending = null; }
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
      cb({ ok:true, state: rooms.snapshot(room), me:{ token, cls: p.cls ? p.cls.id : null } });
    });

    socket.on('pick', (clsId, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      const p = room.players.get(socket.data.token);
      if (!p) return cb && cb({ ok:false, err:'No estás en la sala.' });
      if (p.cls) return cb && cb({ ok:false, err:'Ya tienes héroe.' });
      const taken = [...room.players.values()].some(o => o.cls && o.cls.id === clsId);
      if (taken) return cb && cb({ ok:false, err:'Ese héroe lo ha cogido otro.' });
      const cls = board.CLASSES.find(c => c.id === clsId);
      if (!cls) return cb && cb({ ok:false, err:'Héroe desconocido.' });
      const spot = rooms.freeStart(room);
      p.cls = cls; p.x = spot.x; p.y = spot.y;
      push(room);
      cb && cb({ ok:true, cls:clsId });
    });

    socket.on('move', ({ x, y }, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      const p = room.players.get(socket.data.token);
      if (!p || !p.cls) return cb && cb({ ok:false, err:'Todavía no tienes héroe.' });
      // el servidor decide: no se fía de lo que diga el móvil
      const ok = rooms.reachable(room, p).some(c => c.x === x && c.y === y);
      if (!ok) return cb && cb({ ok:false, err:'No llegas ahí.' });
      p.x = x; p.y = y;
      push(room);
      cb && cb({ ok:true });
    });

    /* ----- editor ----- */
    socket.on('ed:entrar', (clave, cb) => {
      if (!config.CLAVE_EDITOR) return cb({ ok:false, err:'El editor está apagado. Falta poner EDITOR_PASS en Render.' });
      if (clave !== config.CLAVE_EDITOR) return cb({ ok:false, err:'Contraseña incorrecta.' });
      socket.data.editor = true;
      cb({ ok:true, enemigos: catalog.state.catalogo.enemigos, fuente: catalog.state.catalogo.fuente,
           hayDb: config.HAY_DB, falla: catalog.state.fallaDb, base: config.BASE_FICHAS });
    });

    socket.on('ed:recargar', async (_, cb) => {
      if (!socket.data.editor) return cb({ ok:false, err:'No has entrado en el editor.' });
      await catalog.cargarCatalogo();
      for (const room of rooms.rooms.values()){ rooms.poblar(room); push(room); }
      cb({ ok:true, enemigos: catalog.state.catalogo.enemigos, fuente: catalog.state.catalogo.fuente, falla: catalog.state.fallaDb });
    });

    socket.on('ed:guardar', async (fila, cb) => {
      if (!socket.data.editor) return cb({ ok:false, err:'No has entrado en el editor.' });
      if (!fila || !fila.id || !fila.nombre) return cb({ ok:false, err:'Hace falta identificador y nombre.' });
      if (fila.datos && fila.datos.variantes && fila.datos.variantes.length !== 8)
        return cb({ ok:false, err:'Una familia tiene ocho variantes.' });
      fila.id = String(fila.id).trim().toLowerCase().replace(/[^a-z0-9_-]/g,'');
      if (!fila.id) return cb({ ok:false, err:'El identificador sólo admite letras y números.' });
      try {
        await catalog.guardarEnemigo(fila);
        catalog.state.fallaDb = null;
        if (catalog.state.catalogo.fuente !== 'base de datos') catalog.state.catalogo.fuente = 'base de datos';
        const i = catalog.state.catalogo.enemigos.findIndex(e => e.id === fila.id);
        if (i >= 0) catalog.state.catalogo.enemigos[i] = fila; else catalog.state.catalogo.enemigos.push(fila);
        // el cambio entra en las partidas que ya están abiertas, sin reiniciar
        for (const room of rooms.rooms.values()){ rooms.poblar(room); push(room); }
        cb({ ok:true, enemigos: catalog.state.catalogo.enemigos });
      } catch(e){
        cb({ ok:false, err: e.message });
      }
    });

    socket.on('senalar', (id, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false });
      const p = room.players.get(socket.data.token);
      if (!p || !p.cls) return cb && cb({ ok:false });
      // señalar lo mismo otra vez lo quita
      p.senala = (p.senala === id) ? null : id;
      push(room);
      cb && cb({ ok:true, senala: p.senala });
    });

    socket.on('disconnect', () => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room || socket.data.isTv) return;
      const p = room.players.get(socket.data.token);
      if (!p) return;
      p.left = Date.now();
      // no se avisa de golpe: casi todos los cortes duran un par de segundos.
      // sólo si pasan 20 y no ha vuelto se le marca como desconectado.
      if (p.pending) clearTimeout(p.pending);
      p.pending = setTimeout(() => {
        p.pending = null;
        p.online = false;
        if (rooms.rooms.has(room.code)) push(room);
      }, rooms.AVISO);
    });
  });
}

module.exports = registerSockets;
