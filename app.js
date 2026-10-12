(function () {
  'use strict';
  const base = new URL('.', window.location.href).href;
  const scriptUrl = new URL('carina-statistiky.js', base).href;
  const code = `javascript:(()=>{const s=document.createElement('script');s.src=${JSON.stringify(scriptUrl)}+( ${JSON.stringify(scriptUrl)}.includes('?')?'&':'?')+'v='+Date.now();document.head.appendChild(s)})()`;
  const link = document.getElementById('bookmarklet');
  const codeBox = document.getElementById('code');
  const copy = document.getElementById('copy');
  const status = document.getElementById('copy-status');
  link.href = code;
  codeBox.textContent = code;
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      status.textContent = 'Kód záložky zkopírován.';
    } catch (_) {
      status.textContent = 'Automatické kopírování se nepodařilo. Označ kód níže ručně.';
    }
  });
})();
