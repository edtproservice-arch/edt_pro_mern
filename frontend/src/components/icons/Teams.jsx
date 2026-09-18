/**
 * Marque Microsoft Teams — visioconférence des séances synchrones.
 *
 * ⚠️ CE N'EST PAS L'ASSET OFFICIEL. Les bibliothèques d'icônes utilisées ici
 * (lucide) ne fournissent pas de logos de marque, et je ne peux pas restituer
 * fidèlement de mémoire le tracé déposé par Microsoft. Ce dessin en reprend les
 * éléments reconnaissables — carré arrondi violet, « T » blanc, silhouette —
 * dans le violet officiel #6264A7.
 *
 * POUR LE LOGO EXACT : télécharger le SVG depuis les ressources de marque
 * Microsoft (« Microsoft brand assets » / page presse Teams), le déposer dans
 * `frontend/src/assets/`, et remplacer le contenu de `<svg>` ci-dessous par le
 * sien. Le reste du composant — dimensions, couleur, accessibilité — n'a pas à
 * changer.
 *
 * L'usage est NOMINATIF : il désigne le produit réellement employé pour la
 * séance, au même titre qu'un bouton « Se connecter avec Google ». Il ne
 * suggère aucun lien entre EDT Pro et Microsoft.
 */

/** Violet de marque Teams. */
const VIOLET = '#6264A7';

export default function Teams({ className, couleur = VIOLET, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      // Décoratif : le sens est porté par le texte qui accompagne l'icône
      // (« Synchrone », « Teams »), pas par le dessin.
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {/* Silhouette du second participant, en retrait */}
      <circle cx="18.4" cy="6.2" r="2.5" fill={couleur} opacity="0.55" />
      <path
        d="M14.6 10.4h5.9a1.5 1.5 0 0 1 1.5 1.5v3.4a4.4 4.4 0 0 1-4.4 4.4h-.4a4.4 4.4 0 0 1-2.6-.9z"
        fill={couleur}
        opacity="0.55"
      />

      {/* Pastille principale : le « T » blanc sur fond violet */}
      <rect x="1.5" y="4.6" width="13.2" height="14.8" rx="2.2" fill={couleur} />
      <path d="M5 8.1h6.2v1.9H9.1v6.6H7.1v-6.6H5z" fill="#ffffff" />
    </svg>
  );
}
