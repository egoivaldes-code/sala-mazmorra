/* ---------- conexiones ---------- */
const board = require('./board');
const config = require('./config');
const catalog = require('./catalog');
const rooms = require('./rooms');
const combat = require('./combat');

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
        p = { token, name: name || 'Jugador', color: board.primerColorLibre(room), online:true, left:0 };
        room.players.set(token, p);
      }
      // si volvió con el mismo token, recupera los héroes que se quedaron huérfanos al desconectarse
      room.heroes.forEach(h => { if (h.dueno === null && h.duenoAntiguo === token) h.dueno = token; });
      socket.join(code);
      socket.data.code = code;
      socket.data.token = token;
      push(room);
      const misHeroes = room.heroes.filter(h => h.dueno === token).map(h => h.id);
      cb({ ok:true, state: rooms.snapshot(room), me:{ token, color:p.color, heroes:misHeroes } });
    });

    /* elegir un héroe no quita a nadie de la sala: cada jugador puede llevar varios */
    socket.on('pick', (clsId, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      const p = room.players.get(socket.data.token);
      if (!p) return cb && cb({ ok:false, err:'No estás en la sala.' });
      const taken = room.heroes.some(h => h.clsId === clsId);
      if (taken) return cb && cb({ ok:false, err:'Ese héroe lo ha cogido otro.' });
      const cls = board.CLASSES.find(c => c.id === clsId);
      if (!cls) return cb && cb({ ok:false, err:'Héroe desconocido.' });
      const spot = rooms.freeStart(room);
      const heroe = {
        id:'h-'+cls.id, dueno:p.token, duenoAntiguo:p.token, clsId:cls.id, nombre:cls.name, letra:cls.letter,
        speed:cls.speed, alcance:cls.alcance, dano:cls.dano,
        x:spot.x, y:spot.y, vida:cls.vida, max:cls.vida,
        fat:cls.fatiga, maxFat:cls.fatiga, acciones:board.ACCIONES_POR_RONDA,
        caido:false, senala:null
      };
      room.heroes.push(heroe);
      // un héroe más en la mesa cambia el presupuesto de la banda
      rooms.poblar(room);
      push(room);
      const mios = room.heroes.filter(h => h.dueno === p.token).length;
      cb && cb({ ok:true, cls:clsId, mios });
    });

    /* soltar un héroe propio: sólo antes de que empiece la batalla */
    socket.on('soltar', (idHeroe, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      const p = room.players.get(socket.data.token);
      if (!p) return cb && cb({ ok:false, err:'No estás en la sala.' });
      if (!(room.ronda === 1 && room.turno === 'heroes'))
        return cb && cb({ ok:false, err:'La partida ya ha empezado, no puedes soltar héroes.' });
      const i = room.heroes.findIndex(h => h.id === idHeroe && h.dueno === p.token);
      if (i < 0) return cb && cb({ ok:false, err:'Ese héroe no es tuyo.' });
      room.heroes.splice(i, 1);
      // un héroe menos en la mesa también cambia el presupuesto de la banda
      rooms.poblar(room);
      push(room);
      cb && cb({ ok:true });
    });

    /* la tele decide la dificultad de la banda */
    socket.on('tv:dificultad', (nivel, cb) => {
      if (!socket.data.isTv) return cb && cb({ ok:false, err:'Sólo la tele puede cambiar la dificultad.' });
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      if (!board.DIFICULTADES[nivel]) return cb && cb({ ok:false, err:'Dificultad desconocida.' });
      room.dificultad = nivel;
      rooms.poblar(room);
      push(room);
      cb && cb({ ok:true, dificultad:nivel });
    });

    /* cambiar de color: rechaza el que ya lleve otro jugador */
    socket.on('color', (id, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      const p = room.players.get(socket.data.token);
      if (!p) return cb && cb({ ok:false, err:'No estás en la sala.' });
      const color = board.PALETA.find(c => c.id === id);
      if (!color) return cb && cb({ ok:false, err:'Color desconocido.' });
      const enUso = [...room.players.values()].some(o => o.token !== p.token && o.color === id);
      if (enUso) return cb && cb({ ok:false, err:'Ese color ya lo lleva otro.' });
      p.color = id;
      push(room);
      cb && cb({ ok:true, color:id });
    });

    socket.on('move', ({ heroe, x, y }, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      const p = room.players.get(socket.data.token);
      if (!p) return cb && cb({ ok:false, err:'No estás en la sala.' });
      const h = room.heroes.find(o => o.id === heroe && o.dueno === p.token);
      if (!h) return cb && cb({ ok:false, err:'Ese héroe no es tuyo.' });
      const err = compruebaTurno(room, h);
      if (err) return cb && cb({ ok:false, err });
      // el servidor decide: no se fía de lo que diga el móvil.
      // puede tirar de fatiga para llegar más lejos de lo que da su velocidad.
      const destino = rooms.alcanceDe(room, h, h.speed + h.fat).find(c => c.x === x && c.y === y);
      if (!destino) return cb && cb({ ok:false, err:'No llegas ahí.' });
      if (destino.c > h.speed) h.fat -= (destino.c - h.speed);
      h.x = x; h.y = y;
      h.acciones--;
      push(room);
      cb && cb({ ok:true });
    });

    /* comprobaciones comunes a cualquier acción de combate de un héroe:
       que sea su turno, que no esté caído, que le queden acciones, que la
       batalla no haya terminado y que no tenga un símbolo pendiente */
    function compruebaTurno(room, h){
      if (room.fin) return 'La batalla ha terminado.';
      if (room.turno !== 'heroes') return 'No es el turno de los héroes.';
      if (h.caido) return 'Está caído.';
      if (h.pendiente) return 'Resuelve primero el símbolo pendiente.';
      if (h.acciones <= 0) return 'No le quedan acciones.';
      return null;
    }

    /* ataca a un enemigo a su alcance; si sobrevive, hay un 40% de que salga
       un símbolo y el jugador tenga que decidir qué hacer con él */
    socket.on('atacar', ({ heroe, objetivo }, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      const p = room.players.get(socket.data.token);
      if (!p) return cb && cb({ ok:false, err:'No estás en la sala.' });
      const h = room.heroes.find(o => o.id === heroe && o.dueno === p.token);
      if (!h) return cb && cb({ ok:false, err:'Ese héroe no es tuyo.' });
      const err = compruebaTurno(room, h);
      if (err) return cb && cb({ ok:false, err });
      const e = room.enemigos.find(x => x.id === objetivo);
      if (!e) return cb && cb({ ok:false, err:'Ese enemigo ya no está.' });
      if (combat.separacion(h, e) > h.alcance) return cb && cb({ ok:false, err:'Fuera de alcance.' });

      h.acciones--;
      const dano = combat.tirada(h.dano);
      const nombreEnemigo = e.nombre;
      combat.herir(room, e, dano);
      combat.relatar(room, h.nombre + ' ataca a ' + nombreEnemigo + ' (' + dano + ').');

      const sigueVivo = room.enemigos.includes(e);
      if (sigueVivo && Math.random() < 0.4){
        h.pendiente = { objetivo: e.id };
        push(room);
        return cb && cb({ ok:true, simbolo:true, nombre:nombreEnemigo });
      }
      push(room);
      cb && cb({ ok:true, simbolo:false });
    });

    /* resuelve el símbolo que dejó pendiente el último ataque */
    socket.on('simbolo', ({ heroe, opcion }, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      const p = room.players.get(socket.data.token);
      if (!p) return cb && cb({ ok:false, err:'No estás en la sala.' });
      const h = room.heroes.find(o => o.id === heroe && o.dueno === p.token);
      if (!h) return cb && cb({ ok:false, err:'Ese héroe no es tuyo.' });
      if (!h.pendiente) return cb && cb({ ok:false, err:'No hay símbolo pendiente.' });
      const e = room.enemigos.find(x => x.id === h.pendiente.objetivo);
      if (e){
        if (opcion === 'dano'){
          combat.herir(room, e, 2);
          combat.relatar(room, h.nombre + ' aprovecha el símbolo: 2 de daño más a ' + e.nombre + '.');
        } else if (opcion === 'empujar'){
          // una casilla en la dirección contraria al héroe, por el eje donde más se separan
          const dx = e.x - h.x, dy = e.y - h.y;
          const destino = Math.abs(dx) >= Math.abs(dy)
            ? { x: e.x + Math.sign(dx || 1), y: e.y }
            : { x: e.x, y: e.y + Math.sign(dy || 1) };
          if (combat.colocar(room, e, destino.x, destino.y))
            combat.relatar(room, h.nombre + ' empuja a ' + e.nombre + '.');
        }
      }
      h.pendiente = null;
      push(room);
      cb && cb({ ok:true });
    });

    /* levanta a un compañero caído y adyacente: se levanta con media vida y sin acciones */
    socket.on('levantar', ({ heroe, aQuien }, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      const p = room.players.get(socket.data.token);
      if (!p) return cb && cb({ ok:false, err:'No estás en la sala.' });
      const h = room.heroes.find(o => o.id === heroe && o.dueno === p.token);
      if (!h) return cb && cb({ ok:false, err:'Ese héroe no es tuyo.' });
      const err = compruebaTurno(room, h);
      if (err) return cb && cb({ ok:false, err });
      const caido = room.heroes.find(o => o.id === aQuien);
      if (!caido || !caido.caido) return cb && cb({ ok:false, err:'No hay nadie caído ahí.' });
      if (combat.separacion(h, caido) > 1) return cb && cb({ ok:false, err:'Tienes que estar a su lado.' });

      h.acciones--;
      caido.caido = false;
      caido.vida = Math.max(1, Math.floor(caido.max / 2));
      caido.acciones = 0;
      combat.relatar(room, h.nombre + ' levanta a ' + caido.nombre + '.');
      push(room);
      cb && cb({ ok:true });
    });

    /* el grupo decide que ya ha hecho todo lo que quería: pasa el turno a
       los enemigos y, poco después, ellos actúan solos */
    socket.on('fin_ronda', (_, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false, err:'Sala perdida.' });
      if (room.fin) return cb && cb({ ok:false, err:'La batalla ha terminado.' });
      if (room.turno !== 'heroes') return cb && cb({ ok:false, err:'Ya no es el turno de los héroes.' });
      if (room.heroes.some(h => h.pendiente))
        return cb && cb({ ok:false, err:'Hay un símbolo pendiente por resolver.' });
      room.turno = 'enemigos';
      push(room);
      setTimeout(() => {
        if (rooms.rooms.has(room.code)){
          combat.turnoEnemigos(room);
          push(room);
        }
      }, 600);
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

    socket.on('senalar', ({ heroe, objetivo }, cb) => {
      const room = rooms.rooms.get(socket.data.code);
      if (!room) return cb && cb({ ok:false });
      const p = room.players.get(socket.data.token);
      if (!p) return cb && cb({ ok:false });
      const h = room.heroes.find(o => o.id === heroe && o.dueno === p.token);
      if (!h) return cb && cb({ ok:false });
      // señalar lo mismo otra vez lo quita
      h.senala = (h.senala === objetivo) ? null : objetivo;
      push(room);
      cb && cb({ ok:true, senala: h.senala });
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
