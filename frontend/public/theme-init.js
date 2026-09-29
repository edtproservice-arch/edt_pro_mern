/* Applique le thème AVANT le premier rendu, pour éviter un éclair clair en mode sombre.
   Fichier séparé (et non un script en ligne) : la CSP stricte prévue en Phase 11 interdit les scripts en ligne.
   ⚠️ Même clé et mêmes valeurs que `src/lib/theme.js`. */
(function () {
  try {
    var choix = localStorage.getItem('edtpro.theme') || 'clair';
    var sombre =
      choix === 'sombre' ||
      (choix === 'systeme' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (sombre) document.documentElement.classList.add('dark');
  } catch (e) {
    /* sans stockage : thème clair */
  }
})();
