/* ---------- combate ----------
   Aquí vive todo lo que pasa dentro de una ronda: ataques, curas, empujones,
   caídas y la IA de los enemigos. Las salas y el tablero siguen en rooms.js;
   este módulo se apoya en él (alcanceDe, despliegue, occupied). */
const board = require('./board');
const catalog = require('./catalog');
const rooms = require('./rooms');

/* Las casillas que ocupa una unidad: las suyas si es grande, o sólo la suya
   de referencia si es de una casilla. */
function celdasDe(u){
  return u.celdas || [[u.x, u.y]];
}

/* La distancia más corta en cruz entre CUALQUIER casilla de "a" y CUALQUIER
   casilla de "b": una figura 2x2 puede atacar o ser atacada desde cualquiera
   de sus cuatro casillas. */
function separacion(a, b){
  const ca = celdasDe(a), cb = celdasDe(b);
  let min = Infinity;
  for (const [x1,y1] of ca)
    for (const [x2,y2] of cb){
      const d = Math.abs(x1-x2) + Math.abs(y1-y2);
      if (d < min) min = d;
    }
  return min;
}

function heroesTodos(room){
  return room.heroes;
}
function heroesEnPie(room){
  return room.heroes.filter(h => !h.caido);
}

/* Guarda cómo va la batalla: sólo las tres últimas frases, para no llenar la
   tele de texto. */
function relatar(room, texto){
  room.relato = room.relato || [];
  room.relato.push(texto);
  if (room.relato.length > 3) room.relato = room.relato.slice(-3);
}

function tirada([min, max]){
  return min + Math.floor(Math.random() * (max - min + 1));
}

/* Coloca una unidad en (x,y) si cabe entera desplegada; si no, no la mueve. */
function colocar(room, u, x, y){
  const celdas = rooms.despliegue(room, x, y, u.tam, u.id);
  if (!celdas) return false;
  u.x = x; u.y = y; u.celdas = celdas;
  return true;
}

/* Hiere a quien sea: un héroe cae al suelo (no muere) al llegar a 0, un
   enemigo se retira del tablero. Siempre revisa si la batalla ha terminado. */
function herir(room, victima, cantidad){
  victima.vida = Math.max(0, victima.vida - cantidad);
  if ('dueno' in victima){
    if (victima.vida === 0 && !victima.caido){
      victima.caido = true;
      victima.acciones = 0;
      relatar(room, victima.nombre + ' cae al suelo.');
    }
  } else if (victima.vida === 0){
    const i = room.enemigos.indexOf(victima);
    if (i >= 0) room.enemigos.splice(i, 1);
  }
  revisarFinal(room);
}

function revisarFinal(room){
  if (room.enemigos.length === 0){ room.fin = 'victoria'; return; }
  const todos = heroesTodos(room);
  if (todos.length && heroesEnPie(room).length === 0) room.fin = 'derrota';
}

/* ---------- turno de los enemigos ---------- */

function elegirMenosVida(lista){
  if (!lista.length) return null;
  return lista.reduce((a,b) => b.vida < a.vida ? b : a);
}

/* distancia de un punto (por ejemplo, un posible destino) a la unidad más
   cercana de las casillas de "objetivo": para decidir hacia dónde moverse
   sin tener que colocar la ficha primero */
function distanciaAPunto(x, y, objetivo){
  let min = Infinity;
  for (const [ox,oy] of celdasDe(objetivo)){
    const d = Math.abs(x-ox) + Math.abs(y-oy);
    if (d < min) min = d;
  }
  return min;
}

/* Las condiciones de las reglas de cada familia. Todas devuelven el héroe
   objetivo (el de menos vida si hay varios que cumplen) o null si no aplica.
   Las que hablan de la propia unidad (estoy_solo, estoy_herido...) no eligen
   objetivo por sí mismas: cuando se cumplen, apuntan igualmente al héroe con
   menos vida, que es al que tiene más sentido reaccionar. */
const CONDICIONES = {
  heroe_adyacente(room, e){
    return elegirMenosVida(heroesEnPie(room).filter(h => separacion(e,h) <= 1));
  },
  heroe_sin_proteccion(room, e){
    const enPie = heroesEnPie(room);
    return elegirMenosVida(enPie.filter(h => !enPie.some(o => o !== h && separacion(h,o) <= 1)));
  },
  heroe_aislado(room, e){
    const enPie = heroesEnPie(room);
    return elegirMenosVida(enPie.filter(h => !enPie.some(o => o !== h && separacion(h,o) <= 2)));
  },
  heroe_herido_a_la_vista(room, e){
    return elegirMenosVida(heroesEnPie(room).filter(h => h.vida < h.max));
  },
  estoy_solo(room, e){
    const solo = !room.enemigos.some(o => o !== e && separacion(e,o) <= 2);
    return solo ? elegirMenosVida(heroesEnPie(room)) : null;
  },
  estoy_herido(room, e){
    return (e.vida < e.max) ? elegirMenosVida(heroesEnPie(room)) : null;
  },
  aliado_herido_a_la_vista(room, e){
    const hay = room.enemigos.some(o => o !== e && o.vida < o.max);
    return hay ? elegirMenosVida(heroesEnPie(room)) : null;
  },
  somos_mas_que_ellos(room, e){
    return room.enemigos.length > heroesEnPie(room).length ? elegirMenosVida(heroesEnPie(room)) : null;
  },
  hay_varios_heroes_juntos(room, e){
    const enPie = heroesEnPie(room);
    return elegirMenosVida(enPie.filter(h => enPie.some(o => o !== h && separacion(h,o) <= 1)));
  },
  hay_varios_heroes_en_linea(room, e){
    const enPie = heroesEnPie(room);
    return elegirMenosVida(enPie.filter(h => enPie.some(o => {
      if (o === h) return false;
      const [hx,hy] = celdasDe(h)[0], [ox,oy] = celdasDe(o)[0];
      return hx === ox || hy === oy;
    })));
  },
  siempre(room, e){
    return elegirMenosVida(heroesEnPie(room));
  }
};

/* heroe_a_distancia_N (o heroe_a_distancia a secas, con N=4 por defecto) y
   aliado_muere (¿ha caído algún enemigo desde que empezó este turno?) llevan
   un número o un dato extra, así que van fuera del mapa de arriba.
   Devuelve el héroe objetivo, null si la condición no se cumple, o
   undefined si no reconocemos la condición (para que el llamador la trate
   como si la regla no existiera, no como si fallara). */
function evaluarCondicion(nombre, room, e, ctx){
  const dist = /^heroe_a_distancia_?(\d+)?$/.exec(nombre || '');
  if (dist){
    const n = dist[1] ? parseInt(dist[1], 10) : 4;
    return elegirMenosVida(heroesEnPie(room).filter(h => separacion(e,h) <= n));
  }
  if (nombre === 'aliado_muere')
    return (room.enemigos.length < ctx.totalAlEmpezar) ? elegirMenosVida(heroesEnPie(room)) : null;
  const fn = CONDICIONES[nombre];
  return fn ? fn(room, e) : undefined;
}

/* Se acerca hasta que le llega el alcance y entonces pega. Si ya estaba a
   tiro, pega directamente. Esto es lo que hacen tanto "atacar*" como
   cualquier verbo de acercarse, y también el que no reconocemos: nunca se
   queda un bicho parado sin hacer nada. */
function moverYAtacar(room, e, h){
  if (!h) h = elegirMenosVida(heroesEnPie(room));
  if (!h) return;
  const alcance = e.alcance || 1;
  if (separacion(e, h) > alcance) acercarse(room, e, h);
  if (separacion(e, h) <= alcance){
    const dano = tirada(e.dano || [1,2]);
    // se narra antes de herir: si el golpe tira al héroe, que se cuente en
    // ese orden ("ataca" y LUEGO "cae al suelo"), no al revés
    relatar(room, e.nombre + ' ataca a ' + h.nombre + ' (' + dano + ').');
    herir(room, h, dano);
  } else {
    // si no ha llegado a tiro, que quede constancia: si no, una ronda entera
    // de enemigos que sólo caminan no deja ni una frase en la tele
    relatar(room, e.nombre + ' avanza.');
  }
}

function acercarse(room, e, h){
  const opciones = rooms.alcanceDe(room, e, e.velocidad || 4);
  if (!opciones.length) return;
  const mejor = opciones.reduce((a,b) =>
    distanciaAPunto(b.x,b.y,h) < distanciaAPunto(a.x,a.y,h) ? b : a);
  colocar(room, e, mejor.x, mejor.y);
}

function alejarseDe(room, e, h){
  const opciones = rooms.alcanceDe(room, e, e.velocidad || 4);
  if (!opciones.length) return;
  const mejor = opciones.reduce((a,b) =>
    distanciaAPunto(b.x,b.y,h) > distanciaAPunto(a.x,a.y,h) ? b : a);
  colocar(room, e, mejor.x, mejor.y);
}

function huir(room, e, h, haciaAliados){
  if (haciaAliados){
    const aliados = room.enemigos.filter(o => o !== e);
    if (aliados.length){
      const faro = aliados.reduce((a,b) => separacion(e,b) < separacion(e,a) ? b : a);
      const opciones = rooms.alcanceDe(room, e, e.velocidad || 4);
      if (opciones.length){
        const mejor = opciones.reduce((a,b) =>
          distanciaAPunto(b.x,b.y,faro) < distanciaAPunto(a.x,a.y,faro) ? b : a);
        colocar(room, e, mejor.x, mejor.y);
      }
      relatar(room, e.nombre + ' se repliega hacia sus aliados.');
      return;
    }
    // no le queda con quién agruparse: huye del héroe, como cualquier otro
  }
  if (h){
    alejarseDe(room, e, h);
    relatar(room, e.nombre + ' huye.');
  }
}

function curar(room, e){
  const heridos = room.enemigos.filter(o => o !== e && o.vida < o.max);
  if (!heridos.length) return moverYAtacar(room, e, null);
  const objetivo = elegirMenosVida(heridos);
  objetivo.vida = Math.min(objetivo.max, objetivo.vida + 3);
  relatar(room, e.nombre + ' cura a ' + objetivo.nombre + '.');
}

/* Reparte los verbos de "entonces" entre las pocas familias de
   comportamiento que de verdad existen. Hay 25 familias de enemigos y van a
   ir apareciendo verbos que todavía no conocemos: cualquiera que no
   reconozcamos cae en "se acerca y pega", igual que "el resto" de la lista
   del enunciado. Así el bicho nunca se queda quieto. */
function ejecutarAccion(room, e, verbo, objetivo){
  if (verbo === 'curar_3') return curar(room, e);
  if (verbo === 'alejarse' || verbo === 'huir' || verbo === 'huir_hacia_aliados')
    return huir(room, e, objetivo, verbo === 'huir_hacia_aliados');
  moverYAtacar(room, e, objetivo);
}

function reglasDe(room){
  const fam = catalog.state.catalogo.enemigos.find(f => f.id === room.familia);
  return (fam && fam.datos && fam.datos.reglas) || [];
}

/* El turno completo de los enemigos: cada uno actúa según la primera regla
   de su familia que se cumpla (o, si ninguna se cumple o no hay reglas,
   se acerca al héroe con menos vida y pega). Al final los héroes recuperan
   sus acciones, la ronda avanza y vuelve a tocarles a ellos. */
function turnoEnemigos(room){
  const reglas = reglasDe(room);
  const ctx = { totalAlEmpezar: room.enemigos.length };
  const enTurno = room.enemigos.slice();

  for (const e of enTurno){
    if (room.fin) break;
    if (!room.enemigos.includes(e)) continue; // ya había caído antes de que le tocara

    let entonces = null, objetivo = null;
    for (const regla of reglas){
      const r = evaluarCondicion(regla.si, room, e, ctx);
      if (r){ entonces = regla.entonces; objetivo = r; break; }
    }
    if (entonces) ejecutarAccion(room, e, entonces, objetivo);
    else moverYAtacar(room, e, elegirMenosVida(heroesEnPie(room)));
  }

  if (!room.fin){
    room.heroes.forEach(h => { h.acciones = h.caido ? 0 : board.ACCIONES_POR_RONDA; });
    room.ronda++;
    room.turno = 'heroes';
  }
  revisarFinal(room);
}

module.exports = {
  celdasDe, separacion, heroesEnPie, heroesTodos,
  relatar, tirada, colocar, herir, revisarFinal, turnoEnemigos
};
