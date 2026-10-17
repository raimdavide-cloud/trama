// Mostra solo le istruzioni del sistema scelto (di partenza quello rilevato), e riempie l'indirizzo del sito nei comandi.
(function(){
  var os=/win/i.test(navigator.platform||navigator.userAgent)?"win":"mac";
  function show(v){
    document.querySelectorAll(".os-mac").forEach(function(e){e.hidden=v!=="mac"});
    document.querySelectorAll(".os-win").forEach(function(e){e.hidden=v!=="win"});
    document.querySelectorAll(".os button").forEach(function(b){b.setAttribute("aria-pressed",String(b.dataset.os===v))});
  }
  document.querySelectorAll(".os button").forEach(function(b){b.addEventListener("click",function(){show(b.dataset.os)})});
  show(os);
  document.querySelectorAll("[data-origin]").forEach(function(s){s.textContent=location.origin});
  document.querySelectorAll("pre").forEach(function(pre){
    var b=document.createElement("button");b.type="button";b.className="copy";b.textContent="Copia";
    b.addEventListener("click",function(){
      var t=pre.querySelector("code").innerText;
      (navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){b.textContent="Copiato"},function(){b.textContent="Selezionalo e copia"});
      setTimeout(function(){b.textContent="Copia"},2000);
    });
    pre.appendChild(b);
  });
})();
