var s = io(), lista = [], sel = null, base = '';
var $ = function(id){ return document.getElementById(id); };

function estado(r){
  $('fuente').textContent = r.falla
    ? 'La base no responde (' + r.falla + '). Contenido de reserva.'
    : 'Conectado. ' + r.enemigos.length + ' familias.';
  $('fuente').style.color = r.falla ? '#E08C7A' : '';
}
$('pasa').onclick = function(){
  s.emit('ed:entrar', $('cl').value, function(r){
    if (!r.ok){ $('e0').textContent = r.err; return; }
    lista = r.enemigos; base = r.base || '';
    $('puerta').className = 'hide'; $('panel').className = '';
    estado(r); pinta(); elige(lista[0]);
  });
};
$('cl').addEventListener('keydown', function(e){ if (e.key === 'Enter') $('pasa').click(); });

function pinta(){
  var l = $('lista'); l.innerHTML = '';
  lista.forEach(function(e){
    var b = document.createElement('button');
    b.className = 'chip'; b.textContent = e.nombre;
    b.setAttribute('aria-pressed', sel && sel.id === e.id);
    b.onclick = function(){ elige(e); };
    l.appendChild(b);
  });
}

function elige(e){
  if (!e) return;
  sel = e;
  var d = e.datos || {}, b = d.base || {};
  $('tituloFam').textContent = e.nombre;
  $('vid').value = b.vida || 5;
  $('vel').value = b.velocidad || 4;
  $('dan').value = b.dano ? b.dano[0] + '-' + b.dano[1] : '2-3';
  $('aro').value = d.aro || '';
  var caja = $('vars'); caja.innerHTML = '';
  (d.variantes || []).forEach(function(v, i){
    var c = document.createElement('div');
    c.className = 'var';
    c.innerHTML =
      (v.ficha ? '<img src="' + base + v.ficha + '" alt="">' : '<div style="height:96px"></div>') +
      '<input data-i="' + i + '" data-k="papel" value="' + (v.papel || '') + '">' +
      '<input data-i="' + i + '" data-k="vida" type="number" placeholder="vida" value="' + (v.vida || '') + '">' +
      '<select data-i="' + i + '" data-k="tam">' +
        '<option value="1x1">1 casilla</option>' +
        '<option value="2x1">montura</option>' +
        '<option value="2x2">grande</option></select>';
    caja.appendChild(c);
    c.querySelector('select').value = v.tam || '1x1';
  });
  $('e1').textContent = '';
  pinta();
}

$('guardar').onclick = function(){
  var partes = ($('dan').value || '2-3').split('-');
  var d = JSON.parse(JSON.stringify(sel.datos));
  d.base = d.base || {};
  d.base.vida = parseInt($('vid').value, 10) || 5;
  d.base.velocidad = parseInt($('vel').value, 10) || 4;
  d.base.dano = [parseInt(partes[0],10) || 1, parseInt(partes[1],10) || 2];
  if ($('aro').value) d.aro = $('aro').value;
  document.querySelectorAll('#vars [data-i]').forEach(function(campo){
    var v = d.variantes[+campo.dataset.i], k = campo.dataset.k;
    if (k === 'vida'){ if (campo.value) v.vida = parseInt(campo.value,10); else delete v.vida; }
    else v[k] = campo.value;
  });
  s.emit('ed:guardar', { id: sel.id, nombre: sel.nombre, datos: d }, function(r){
    var e = $('e1');
    if (!r.ok){ e.className = 'err'; e.textContent = r.err; return; }
    lista = r.enemigos;
    sel = lista.filter(function(x){ return x.id === sel.id; })[0];
    e.className = 'err ok'; e.textContent = 'Guardado. Míralo en la tele.';
    pinta();
  });
};

$('recargar').onclick = function(){
  s.emit('ed:recargar', null, function(r){
    if (!r.ok){ $('e1').textContent = r.err; return; }
    lista = r.enemigos; estado(r); pinta(); elige(lista[0]);
  });
};
