import { echapperXml } from '../seances/xmlCellules.js';

/**
 * Les badges de numéros de table — SANS informations
 * (`Badges_Numeros_Sans_Infos_DEVOWFS201.docx`) ou AVEC celles du stagiaire
 * (`Badges_Numeros_Table_DEVOWFS201 (12).docx`), 2026-10-02, demandes du
 * porteur — à découper et poser sur les tables de l'examen.
 *
 * ═══ COMMENT CES CANEVAS SONT FAITS ═══
 * UN tableau de mise en page : une rangée « ✂ » qui s'étend sur les trois
 * colonnes, puis des rangées de TROIS cases, chacune portant le tableau d'UN
 * badge (imbriqué) — le numéro | le logo, l'établissement, (le groupe, le
 * matricule, le nom, le prénom,) « Bon courage ☺ ». La dernière rangée se
 * complète de cases vides. Les deux ne diffèrent que par les textes d'un
 * badge : `champs` les nomme, dans leur ordre.
 *
 * ⚠️ UN BADGE PAR STAGIAIRE, NUMÉROTÉ 1 À N DANS L'ORDRE ALPHABÉTIQUE : le même
 * N° que sur la liste des stagiaires du groupe. Un groupe par page.
 *
 * ⚠️ LE NUMÉRO RÉTRÉCIT À DEUX CHIFFRES : à 48 pt dans sa case de 2,4 cm,
 * « 10 » passait sur deux lignes (« 1 / 0 ») — constaté sur le canevas même.
 */

const PAR_RANGEE = 3;
const TAILLE_NUMERO = { 1: 96, 2: 72, 3: 52 };

/**
 * Les `<w:tbl>`/`<w:tr>`/`<w:tc>` enfants DIRECTS du fragment — jamais ceux
 * d'un tableau imbriqué. `racine` : combien de `<w:tbl>` le fragment ouvre
 * lui-même avant ses enfants (1 pour les rangées d'un tableau, 0 sinon).
 */
function enfants(xml, balise, racine = 0) {
  const re = new RegExp(`<w:tbl>|</w:tbl>|<w:${balise}\\b[^>]*>|</w:${balise}>`, 'g');
  const trouves = [];
  let profondeurTable = 0;
  let profondeur = 0;
  let debut = -1;
  let m;
  while ((m = re.exec(xml))) {
    const jeton = m[0];
    const ouvre = jeton === `<w:${balise}>` || (jeton.startsWith(`<w:${balise}`) && !jeton.startsWith('</'));
    if (balise !== 'tbl' && jeton === '<w:tbl>') profondeurTable += 1;
    else if (balise !== 'tbl' && jeton === '</w:tbl>') profondeurTable -= 1;
    else if (ouvre) {
      if (profondeurTable === racine && profondeur === 0) debut = m.index;
      profondeur += 1;
    } else {
      profondeur -= 1;
      if (profondeurTable === racine && profondeur === 0) trouves.push(xml.slice(debut, m.index + jeton.length));
    }
  }
  return trouves;
}

/**
 * Le badge d'UN stagiaire : la case du canevas, ses `<w:t>` réécrits DANS
 * L'ORDRE de `champs` — le premier est toujours le numéro. Les espaces en tête
 * d'un texte du canevas (« ␣␣CFP MGD HASSANIA », pour l'écart avec le logo)
 * sont gardés.
 */
function remplirBadge(caseModele, champs, valeurs) {
  let index = -1;
  const remplie = caseModele.replace(/(<w:t)(?:\s[^>]*)?>([^<]*)(<\/w:t>)/g, (tout, ouverture, ancien, fermeture) => {
    index += 1;
    if (index >= champs.length) return tout;
    const marge = ancien.match(/^\s*/)[0];
    return `${ouverture} xml:space="preserve">${marge}${echapperXml(valeurs[champs[index]] ?? '')}${fermeture}`;
  });

  // Le numéro rétrécit avec son nombre de chiffres — la taille est dans le run du PREMIER texte.
  const taille = TAILLE_NUMERO[Math.min(String(valeurs.numero).length, 3)];
  return remplie.replace(
    /<w:sz w:val="\d+"\/><w:szCs w:val="\d+"\/>(<\/w:rPr><w:t\b)/,
    `<w:sz w:val="${taille}"/><w:szCs w:val="${taille}"/>$1`
  );
}

/**
 * Le corps du document : un tableau de badges par groupe, séparés par un saut
 * de page. `corps` est le corps du canevas, entre `<w:body>` et `<w:sectPr>`.
 *
 * @param {string[]} champs — les champs écrits, dans l'ordre des textes d'un
 *   badge du canevas : `numero` d'abord, puis `efp`, `groupe`, `matricule`…
 */
export const corpsBadgesNumeros = (champs) => (corps, feuilles, sautDePage) => {
  const [table] = enfants(corps, 'tbl');
  if (!table) throw new Error('Canevas Word illisible : la grille des badges est absente');

  const rangees = enfants(table, 'tr', 1);
  const [rangeeCiseaux, premiereRangee] = rangees;
  const cases = enfants(premiereRangee, 'tc');
  const caseVide = enfants(rangees.at(-1), 'tc').at(-1);
  if (!cases[0] || !caseVide) throw new Error('Canevas Word illisible : cases de badge attendues');

  const ouvertureRangee = premiereRangee.slice(0, premiereRangee.indexOf(cases[0]));
  const ouvertureTable = table.slice(0, table.indexOf(rangeeCiseaux));

  return feuilles
    .map((feuille) => {
      const badges = feuille.stagiaires.map((stagiaire, index) =>
        remplirBadge(cases[0], champs, { ...stagiaire, numero: index + 1, efp: feuille.efp, groupe: feuille.groupe })
      );
      while (badges.length % PAR_RANGEE !== 0) badges.push(caseVide);
      const lignes = [];
      for (let i = 0; i < badges.length; i += PAR_RANGEE) {
        lignes.push(`${ouvertureRangee}${badges.slice(i, i + PAR_RANGEE).join('')}</w:tr>`);
      }
      return `${ouvertureTable}${rangeeCiseaux}${lignes.join('')}</w:tbl><w:p/>`;
    })
    .join(sautDePage);
};
