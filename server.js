/* Sala de mazmorra - prueba de sincronización
   Una sala, varios móviles, una tele. El servidor manda. */

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const config = require('./src/config');
const board = require('./src/board');
const catalog = require('./src/catalog');
const rooms = require('./src/rooms');
const registerSockets = require('./src/sockets');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/api/clases', (_, res) => res.json(board.CLASSES));
app.get('/editor', (_, res) => res.sendFile(path.join(__dirname, 'public', 'editor.html')));
app.get('/tv', (_, res) => res.sendFile(path.join(__dirname, 'public', 'tv.html')));
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/salud', (_, res) => res.json({ ok:true, salas: rooms.rooms.size }));

registerSockets(io);
rooms.startCleanup();

catalog.cargarCatalogo().then(() => {
  server.listen(config.PORT, () => {
    console.log('En marcha en el puerto ' + config.PORT);
    console.log('Contenido: ' + catalog.state.catalogo.fuente + '. Editor: ' + (config.CLAVE_EDITOR ? 'activo' : 'apagado'));
  });
});
