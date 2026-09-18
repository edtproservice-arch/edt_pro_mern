/**
 * La couleur d'une personne dans la collaboration en temps réel.
 *
 * ⚠️ DÉTERMINISTE : la même personne garde la même couleur d'un rechargement à
 * l'autre, et sur l'écran de chacun. C'est ce qui permettra, à l'étape (b), de
 * rattacher un curseur coloré dans la grille à un avatar de la pile — une
 * couleur tirée au hasard changerait à chaque connexion.
 *
 * ⚠️ DES CLASSES LITTÉRALES : Tailwind lit les classes dans le source, un nom
 * composé à l'exécution (`bg-${teinte}`) ne serait jamais généré — piège déjà
 * payé plusieurs fois dans ce projet.
 *
 * ⚠️ JAMAIS LE BLEU STRUCTUREL (`primary`), réservé par le design system, ni
 * le rouge, qui signifie une absence ou une surcharge dans la grille. Les
 * teintes pleines (`fond`) portent du blanc : étiquette du curseur, cadre
 * « X modifie », posés sur une grille déjà colorée.
 *
 * ═══ `pastille` : L'AVATAR EN TEINTE CLAIRE (2026-09-13, demande du porteur) ═══
 * Un rond plein et foncé dans la barre du haut pesait plus que tout le reste de
 * la ligne. Fond pâle de la même teinte, initiales dans sa nuance foncée : la
 * personne garde sa couleur — celle de son curseur — sans l'aplat. ⚠️ Le fond
 * est TRANSLUCIDE : là où les avatars se chevauchent, l'appelant pose un fond
 * opaque dessous, sinon l'un se lit à travers l'autre.
 */
export const COULEURS_PRESENCE = [
  { fond: 'bg-accent-teal', pastille: 'bg-accent-teal/15 text-accent-teal', anneau: 'ring-accent-teal', texte: 'text-accent-teal', bordure: 'border-accent-teal' },
  { fond: 'bg-accent-purple-mid', pastille: 'bg-accent-purple/40 text-accent-purple-deep', anneau: 'ring-accent-purple-mid', texte: 'text-accent-purple-mid', bordure: 'border-accent-purple-mid' },
  { fond: 'bg-accent-orange', pastille: 'bg-accent-orange/15 text-accent-orange', anneau: 'ring-accent-orange', texte: 'text-accent-orange', bordure: 'border-accent-orange' },
  { fond: 'bg-accent-sky-deep', pastille: 'bg-accent-sky/25 text-accent-sky-deep', anneau: 'ring-accent-sky-deep', texte: 'text-accent-sky-deep', bordure: 'border-accent-sky-deep' },
  { fond: 'bg-accent-green-deep', pastille: 'bg-accent-green/15 text-accent-green-deep', anneau: 'ring-accent-green-deep', texte: 'text-accent-green-deep', bordure: 'border-accent-green-deep' },
  { fond: 'bg-accent-pink', pastille: 'bg-accent-pink/15 text-[hsl(320_80%_38%)]', anneau: 'ring-accent-pink', texte: 'text-accent-pink', bordure: 'border-accent-pink' },
  { fond: 'bg-accent-brown', pastille: 'bg-accent-brown/15 text-accent-brown', anneau: 'ring-accent-brown', texte: 'text-accent-brown', bordure: 'border-accent-brown' },
  { fond: 'bg-accent-orange-deep', pastille: 'bg-accent-orange-deep/15 text-accent-orange-deep', anneau: 'ring-accent-orange-deep', texte: 'text-accent-orange-deep', bordure: 'border-accent-orange-deep' },
];

/** Empreinte djb2 — stable, sans dépendance, et suffisante pour répartir huit teintes. */
function empreinte(texte) {
  let h = 5381;
  for (let i = 0; i < texte.length; i += 1) h = (h * 33) ^ texte.charCodeAt(i);
  return h >>> 0;
}

export function couleurPresence(identifiant) {
  return COULEURS_PRESENCE[empreinte(String(identifiant ?? '')) % COULEURS_PRESENCE.length];
}
