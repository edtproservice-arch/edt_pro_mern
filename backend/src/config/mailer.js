import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import { env } from './env.js';
import { logger } from '../lib/logger.js';

/**
 * Envoi d'e-mails. ← remplace PHPMailer, instancié et reconfiguré à la main
 * dans chaque endpoint qui envoyait un message (login.php:233, register.php,
 * request_reset.php…), avec les identifiants SMTP recopiés à chaque fois.
 *
 * Sans configuration SMTP, les messages sont journalisés au lieu d'être
 * envoyés : le développement ne dépend pas d'un compte de messagerie, et les
 * tests n'envoient jamais de vrai courriel.
 */
const smtpConfigure = Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

const transport = smtpConfigure
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // 465 = TLS implicite ; 587 = STARTTLS, négocié après connexion.
      secure: env.SMTP_PORT === 465,
      // Sur 587, exige la montée en TLS : sans cela nodemailer accepterait de
      // poursuivre en clair si le serveur n'annonce pas STARTTLS, et les
      // identifiants partiraient en clair (attaque par suppression de STARTTLS).
      requireTLS: env.SMTP_PORT !== 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    })
  : null;

/**
 * ═══ ⚠️ LE LOGO EST UN PNG, PAS LE SVG DE L'APPLICATION ═══
 * (demande du porteur, 2026-09-02.) Gmail, Outlook et Yahoo ne rendent PAS le
 * SVG dans un e-mail — l'image y reste blanche. Le fichier est donc un RASTER
 * exporté du même tracé, à régénérer si la marque change (cf. DESIGN_SYSTEM.md).
 *
 * ⚠️ ET IL VOYAGE EN PIÈCE JOINTE (cid), PAS PAR URL. Deux raisons : il n'y a
 * pas encore d'hébergement public (Phase 1), et une image DISTANTE dans un
 * courriel de service se comporte comme un pixel de suivi — bloquée par défaut
 * chez beaucoup, et mauvais signal pour les filtres. En pièce jointe, elle
 * s'affiche sans réseau et sans rien tracer.
 *
 * ⚠️ SON FOND EST TRANSPARENT : il se compose sur le blanc de la page comme sur
 * n'importe quel autre fond, sans dessiner de rectangle autour de la marque.
 */
const CID_LOGO = 'logo-edtpro';

const logo = (() => {
  try {
    return fs.readFileSync(fileURLToPath(new URL('../assets/logo-email.png', import.meta.url)));
  } catch (erreur) {
    // Un logo manquant ne doit pas empêcher un code de vérification de partir.
    logger.warn({ err: erreur }, 'Logo e-mail introuvable — les messages partiront sans');
    return null;
  }
})();

const adresseExpediteur = env.SMTP_FROM || env.SMTP_USER;
const expediteur = `"${env.SMTP_FROM_NAME}" <${adresseExpediteur}>`;
const adresseReponse = env.SMTP_REPLY_TO || adresseExpediteur;

/**
 * Gabarit HTML commun aux QUATRE messages du produit — code de vérification,
 * réinitialisation par l'admin, par le directeur, changement de statut.
 *
 * Les e-mails de l'existant embarquaient chacun leur propre bloc HTML recopié
 * (login.php:254-279, register.php…), ce qui les faisait diverger.
 *
 * ═══ MISE EN PAGE ═══ (gabarit Slack fourni par le porteur, 2026-09-02.)
 * Tout est ALIGNÉ À GAUCHE sur une page BLANCHE, sans carte : logo, grand titre,
 * corps, puis la valeur à recopier dans un bloc gris pleine largeur.
 *
 * ⚠️ LE PIED N'EST QU'UN FILET POINTILLÉ suivi des mentions (demande du porteur,
 * 2026-09-02) : ni réseaux sociaux — le produit n'a pas de comptes — ni second
 * logo, ni liens. Le trait sépare aussi bien, et ne peut pas devenir faux.
 *
 * La structure vise aussi la DÉLIVRABILITÉ. Un message court dont le contenu
 * principal est un code à 6 chiffres a exactement la silhouette d'un
 * hameçonnage, et part en indésirable. On y remédie en donnant au message ce
 * qu'un vrai courriel de service contient :
 *   - un expéditeur identifié et une raison explicite de le recevoir,
 *   - une consigne de sécurité (« si ce n'est pas vous… »),
 *   - une adresse de réponse qui fonctionne,
 *   - un rapport texte/HTML équilibré, sans pixel de suivi.
 */
export function enveloppeHtml({ texte, titre, raison }) {
  /*
   * Le corps arrive en TEXTE, découpé en paragraphes par les lignes vides.
   * C'est ce qui garantit que la version texte et la version HTML disent la
   * MÊME chose : une seule source, deux rendus. Un gabarit HTML écrit à part
   * finirait par dire autre chose que le texte — or c'est la version TEXTE
   * que lisent les filtres anti-spam.
   */
  const paragraphes = texte.split('\n\n').filter((bloc) => bloc.trim() !== '');

  /*
   * ⚠️ « L'équipe EDT Pro » N'EST PAS RENDUE EN HTML : le gabarit Slack n'a pas
   * de signature, et le pied dit déjà de qui vient le message. Elle RESTE dans
   * la version texte, qui n'a pas de pied.
   */
  if (paragraphes.at(-1)?.trim().startsWith("L'équipe")) paragraphes.pop();

  const rangValeur = paragraphes.findIndex((bloc) => estValeur(bloc.trim()));
  const corps = paragraphes.map((bloc, rang) => rendreBloc(bloc.trim(), rang, rangValeur)).join('');

  return `<!doctype html>
<html dir="ltr" lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- ⚠️ Sans cette balise, iOS Mail « reformate » le message : il grossit
     certains textes de son propre chef et la hiérarchie s'effondre. -->
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${echapper(titre)}</title>
</head>
<body dir="ltr" lang="fr" style="margin:0;padding:0;background:#ffffff;${POLICE}-webkit-text-size-adjust:100%;">
  <!-- Aperçu de la liste des messages : sans lui, les clients y recopient le
       premier texte venu, souvent « Bonjour <nom> ». -->
  <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${echapper(titre)}</div>

  <!--
    ⚠️ TABLEAUX, PAS « div » + « flex » : Outlook rend le HTML avec le moteur de
    Word, qui ignore flex, grid et la plupart des mises en page modernes. Le
    gabarit est traduit, pas recopié.
  -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:#ffffff;">
    <tr><td>
      <table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0"
             style="max-width:37.5em;margin:0 auto;">
        <tr><td style="padding:0 20px;">

          ${enTete('32px')}

          <!-- ⚠️ LE TITRE EST LE SUJET DU MESSAGE, pas un champ de plus : deux
               textes distincts finiraient par se contredire, et c'est le sujet
               que le lecteur vient de lire dans sa liste. -->
          <h1 style="margin:30px 0;padding:0;font-size:30px;line-height:36px;font-weight:700;color:#1d1c1d;${POLICE}">
            ${echapper(titre)}
          </h1>

          ${corps}

          <!--
            ── Pied ──────────────────────────────────────────────────────────
            ⚠️ UN FILET POINTILLÉ, PLUS UN SECOND LOGO NI DE LIENS (demande du
            porteur, 2026-09-02). Le logo répété doublait la marque à 40 cm
            d'intervalle sans rien apprendre, et les trois pages légales
            pointaient sur des chemins que la Phase 11 déplacera. Le trait
            sépare aussi bien, et ne peut pas devenir faux.

            ⚠️ LE FILET EST SUR UN « td », pas sur un « div » : Outlook ignore
            les bordures d'un « div » mais respecte celles d'une cellule.
          -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
                 style="margin:32px 0 0;">
            <tr><td style="border-top:1px dashed #dddddd;font-size:0;line-height:0;">&nbsp;</td></tr>
          </table>

          <p style="margin:20px 0 50px;font-size:12px;line-height:18px;color:#b7b7b7;${POLICE}">
            ${echapper(raison)}<br>
            Une question&nbsp;? Répondez à ce message, ou écrivez à
            <a href="mailto:${adresseReponse}" style="color:#b7b7b7;">${adresseReponse}</a>.<br><br>
            &copy; ${new Date().getFullYear()} EDT&nbsp;Pro — ${env.APP_URL}<br>
            Tous droits réservés.
          </p>

        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/* ── Les pièces du gabarit ─────────────────────────────────────────────────── */

/*
 * ═══ ⚠️ LA POLICE SE DÉCLARE SUR CHAQUE TEXTE, PAS UNE FOIS SUR « body » ═══
 * Outlook n'hérite pas la police à travers les tableaux : posée sur le seul
 * « body », tout le message retombe en TIMES. Constaté à l'écran sur ce gabarit
 * même, avant correction.
 *
 * ⚠️ ET C'EST UNE PILE SYSTÈME, pas Inter : une police web ne se charge pas dans
 * un courriel — Gmail ignore les règles de police téléchargée — et le message
 * s'afficherait dans la police de repli sans qu'on l'ait choisie.
 */
const POLICE =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;";

/**
 * Un paragraphe du corps.
 *
 * ═══ ⚠️ CE QUI SUIT LA VALEUR EST UNE NOTE, PAS DU CORPS ═══
 * Dans les quatre messages, l'ordre est le même : on présente, on donne la
 * valeur, puis on précise (« valable 15 minutes », « si ce n'est pas vous… »).
 * Le gabarit met l'introduction en 20 px et ces précisions en 14 px — c'est la
 * POSITION qui les désigne, aucun champ n'a à le déclarer.
 *
 * ⚠️ SANS VALEUR, TOUT RESTE EN CORPS : le message de changement de statut n'a
 * qu'une phrase, et la rendre en note la ferait passer pour une mention légale.
 */
function rendreBloc(texte, rang, rangValeur) {
  if (rang === rangValeur) return rendreValeur(texte);

  const note = rangValeur !== -1 && rang > rangValeur;
  const style = note
    ? `margin:16px 0;font-size:14px;line-height:24px;color:#000000;${POLICE}`
    : `margin:16px 0 30px;font-size:20px;line-height:28px;color:#1d1c1d;${POLICE}`;

  return `<p style="${style}">${echapper(texte).replace(/\n/g, '<br>')}</p>`;
}

/**
 * La valeur à recopier : un bloc GRIS pleine largeur, texte centré.
 *
 * ⚠️ UN CODE EST ESPACÉ, UN MOT DE PASSE NON : la seconde valeur est sensible à
 * la casse, et l'espacement des lettres la rend plus difficile à lire et à
 * recopier — on douterait même des espaces qu'elle contient.
 *
 * ⚠️ LE FOND EST SUR LE « td », pas sur le tableau : Outlook ne peint pas le
 * fond d'un « table » de façon fiable.
 */
function rendreValeur(valeur) {
  const code = /^\d{6}$/.test(valeur);
  const style = code
    ? 'font-size:30px;line-height:36px;letter-spacing:10px;'
    : 'font-size:26px;line-height:34px;word-break:break-all;';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="margin:0 0 30px;">
      <tr><td align="center"
              style="background:#f5f4f5;border-radius:4px;padding:40px 10px;">
        <span style="${style}color:#1d1c1d;${POLICE}">${echapper(valeur)}</span>
      </td></tr>
    </table>`;
}

/**
 * ⚠️ « width » ET « height » EN ATTRIBUTS, pas seulement en CSS : sans eux,
 * Outlook réserve la taille NATIVE de l'image (336 px) et déborde de la colonne.
 *
 * ⚠️ « display:block » : sans lui, la ligne de base du texte ajoute quelques
 * pixels sous l'image, et l'espacement paraît décalé.
 *
 * ⚠️ L'« alt » PORTE LE NOM : une image bloquée — c'est le réglage par défaut de
 * plusieurs clients — doit encore dire de qui vient le message.
 */
const enTete = (haut) =>
  logo
    ? `<img src="cid:${CID_LOGO}" alt="EDT Pro" width="120" height="57"
            style="display:block;width:120px;height:57px;margin:${haut} 0 0;border:0;outline:none;text-decoration:none;">`
    : `<p style="margin:${haut} 0 0;font-size:22px;font-weight:700;color:#489c5a;${POLICE}">eDT<span style="color:#0071db;">pro</span></p>`;

/*
 * Un paragraphe qui n'est QU'UNE valeur à recopier : aucun espace, assez long
 * pour ne pas être un mot de la phrase, assez court pour ne pas être une URL.
 */
const estValeur = (bloc) => /^[A-Za-z0-9_-]{6,32}$/.test(bloc);

const echapper = (valeur) =>
  String(valeur ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * @param {object} message
 * @param {string} message.raison  Pourquoi le destinataire reçoit ce message.
 *   Obligatoire : c'est l'élément qui distingue un courriel de service d'un
 *   hameçonnage, aux yeux du lecteur comme des filtres.
 */
export async function envoyerEmail({ destinataire, sujet, texte, raison, html }) {
  if (!transport) {
    logger.warn({ destinataire, sujet, texte }, 'SMTP non configuré — e-mail non envoyé');
    return { envoye: false };
  }

  const motif = raison ?? 'Vous recevez ce message suite à une action sur votre compte EDT Pro.';

  try {
    const info = await transport.sendMail({
      from: expediteur,
      to: destinataire,
      replyTo: adresseReponse,
      subject: sujet,
      text: `${texte}\n\n---\n${motif}\n${env.APP_URL}`,
      html: html ?? enveloppeHtml({ texte, titre: sujet, raison: motif }),
      /*
       * ⚠️ `contentDisposition: 'inline'` EST INDISPENSABLE : sans lui,
       * nodemailer joint le fichier en PIÈCE JOINTE VISIBLE — le lecteur voit
       * un trombone et un fichier à télécharger, en plus de l'image déjà
       * affichée dans le message.
       *
       * ⚠️ Et le logo n'est joint QUE si le gabarit maison est utilisé : un
       * appelant qui fournit son propre `html` ne référence pas ce `cid`, et la
       * pièce jointe resterait orpheline.
       */
      attachments:
        logo && !html
          ? [{ filename: 'edtpro.png', content: logo, cid: CID_LOGO, contentDisposition: 'inline' }]
          : undefined,
      headers: {
        // Indique aux filtres qu'il s'agit d'un message automatique légitime,
        // et évite les réponses automatiques (absences du bureau) en retour.
        'Auto-Submitted': 'auto-generated',
      },
    });
    return { envoye: true, id: info.messageId };
  } catch (erreur) {
    // Un envoi qui échoue ne doit pas faire échouer l'opération métier : une
    // inscription reste valide même si l'e-mail de confirmation n'est pas parti.
    // L'utilisateur peut redemander un code.
    logger.error({ err: erreur, destinataire, sujet }, "Échec de l'envoi d'e-mail");
    return { envoye: false, erreur: erreur.message };
  }
}

/** Vérifie la connexion SMTP sans envoyer de message. Utilisé par le diagnostic. */
export async function verifierSmtp() {
  if (!transport) return { configure: false };
  await transport.verify();
  return { configure: true };
}
