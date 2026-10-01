/** Ce que le Word, le PDF et l'Excel des billets d'excuse ont en commun : dates et nom du fichier. */

/** « 2026-09-14 » → « 14/09/2026 » — la date est déjà une chaîne AAAA-MM-JJ sur `AbsenceStagiaire`. */
export function dateCourte(dateIso) {
  const [annee, mois, jour] = String(dateIso ?? '').split('-');
  if (!annee || !mois || !jour) return String(dateIso ?? '');
  return `${jour}/${mois}/${annee}`;
}

/**
 * « Billet_Excuse_ALAOUI_Yassine_2026-09-14.pdf » pour un seul,
 * « Billets_Excuse_3_2026-09-16.pdf » pour plusieurs (2026-09-29, demande du
 * porteur : « si deux stagiaires justifient en même temps il s'affiche deux
 * billets ») — le nom d'UN stagiaire n'aurait plus de sens dès que le
 * document en porte plusieurs.
 */
export function nomFichierBillets(billets, extension) {
  if (billets.every((billet) => billet.vierge)) return `Billets_Excuse_vierges.${extension}`;
  if (billets.length === 1) {
    const { nom, prenom, date } = billets[0];
    const nomFichier = `${nom} ${prenom}`.trim().replace(/\s+/g, '_') || 'stagiaire';
    return `Billet_Excuse_${nomFichier}_${date}.${extension}`;
  }
  const aujourdhui = new Date();
  const deux = (n) => String(n).padStart(2, '0');
  const dateDuJour = `${aujourdhui.getFullYear()}-${deux(aujourdhui.getMonth() + 1)}-${deux(aujourdhui.getDate())}`;
  return `Billets_Excuse_${billets.length}_${dateDuJour}.${extension}`;
}
