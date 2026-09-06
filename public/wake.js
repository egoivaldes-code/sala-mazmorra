/* Pide al móvil que no apague la pantalla mientras se juega.
   Si el navegador no sabe hacerlo, no pasa nada: sigue como antes. */
var wl = null;
function despierta(){
  if (!('wakeLock' in navigator)) return;
  navigator.wakeLock.request('screen').then(function(l){
    wl = l;
    l.addEventListener('release', function(){ wl = null; });
  }).catch(function(){});
}
document.addEventListener('visibilitychange', function(){
  if (document.visibilityState === 'visible' && wl === null) despierta();
});
