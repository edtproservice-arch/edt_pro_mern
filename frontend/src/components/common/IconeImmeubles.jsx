/**
 * L'icône du partage : deux immeubles, pleins (2026-09-23, choix du porteur — tracé
 * fourni tel quel).
 *
 * ⚠️ `fill="currentColor"` : elle suit la couleur du texte, comme les icônes lucide à
 * côté desquelles elle se range, et prend `className` (`size-4`…) comme elles. Les
 * attributs de l'extrait d'origine (classes et variables CSS de la page source) sont
 * retirés : ils ne voulaient rien dire ici.
 *
 * ═══ ⚠️ `viewBox` RESSERRÉ SUR LE DESSIN (2026-09-23, signalé par le porteur : « l'icône
 * ne s'affiche pas bien, agrandir sa taille ») ═══ Le cadre d'origine (`1 0 18 20`)
 * laissait du vide : le dessin va de x = 1,84 à 18,16 et de y = 3,3 à 16,7, soit moins
 * des DEUX TIERS de la hauteur. À `size-4`, il faisait 11 px de haut — nettement plus
 * petit que l'étoile et le « … » voisins, dont le dessin remplit leur carré.
 * Le cadre est maintenant le plus petit CARRÉ qui le contient, centré (10, 10) :
 * `1.6 1.6 16.8 16.8`. Carré, pour ne pas être déformé ni décentré dans `size-4`.
 */
export default function IconeImmeubles({ className, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="1.6 1.6 16.8 16.8"
      fill="currentColor"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {/* Les fenêtres */}
      <path d="M5.48 9.303a.675.675 0 1 1 0 1.35.675.675 0 0 1 0-1.35m3.015 0a.675.675 0 1 1 0 1.35.675.675 0 0 1 0-1.35M5.48 6.287a.676.676 0 1 1-.002 1.351.676.676 0 0 1 .001-1.35m3.016-.001a.676.676 0 1 1-.002 1.352.676.676 0 0 1 .002-1.352m6.03 6.03a.675.675 0 1 1 0 1.35.675.675 0 0 1 0-1.35m0-3.014a.675.675 0 1 1 0 1.35.675.675 0 0 1 0-1.35" />
      {/* Les deux bâtiments et la porte */}
      <path d="M10.16 3.3c1.09 0 1.974.884 1.975 1.974v1.05h4.05c1.09 0 1.975.883 1.975 1.974v7.777c0 .345-.28.625-.625.625H2.465a.625.625 0 0 1-.625-.625v-10.8c0-1.091.884-1.975 1.974-1.975zM3.814 4.55c-.4 0-.724.324-.724.724V15.45h1.84v-2.458a.55.55 0 0 1 .55-.55h3.014a.55.55 0 0 1 .55.55v2.458h1.84V5.274c0-.4-.324-.724-.724-.724zm8.32 10.9h4.776V8.298c0-.4-.324-.725-.724-.725h-4.051zm-6.105 0h1.915v-1.908H6.03z" />
    </svg>
  );
}
