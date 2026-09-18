import { describe, it, expect } from 'vitest';
import { enveloppeHtml } from '../../src/config/mailer.js';

/**
 * Le gabarit HTML des e-mails.
 *
 * ⚠️ IL N'AVAIT AUCUN TEST alors qu'il porte les QUATRE messages du produit —
 * vérification d'adresse, réinitialisation par l'admin, par le directeur, et
 * changement de statut. Une régression n'y serait vue que par un destinataire.
 */
const rendre = (texte, raison = 'Une raison.') =>
  enveloppeHtml({ texte, titre: 'Sujet du message', raison });

describe('enveloppeHtml', () => {
  it('reprend le corps, la raison et le titre', () => {
    const html = rendre('Bonjour,\n\nUn paragraphe.');

    expect(html).toContain('Un paragraphe.');
    expect(html).toContain('Une raison.');
    expect(html).toContain('Sujet du message');
  });

  /*
   * ⚠️ LE LOGO EST RÉFÉRENCÉ PAR SON `cid`, jamais par une URL : c'est ce qui
   * lui permet de s'afficher sans réseau et sans rien tracer.
   */
  it('référence le logo en pièce jointe, pas par une adresse distante', () => {
    const html = rendre('Bonjour.');

    expect(html).toContain('src="cid:logo-edtpro"');
    expect(html).not.toMatch(/<img[^>]+src="https?:/);
  });

  it('donne un texte de remplacement au logo, pour une image bloquée', () => {
    expect(rendre('Bonjour.')).toContain('alt="EDT Pro"');
  });

  /*
   * ⚠️ SVG INTERDIT : Gmail, Outlook et Yahoo ne le rendent pas. Le jour où
   * quelqu'un pointera le gabarit sur le SVG de l'application, ce test tombe.
   */
  it('ne sert jamais le logo en SVG', () => {
    expect(rendre('Bonjour.')).not.toContain('.svg');
  });

  describe('la valeur à recopier ressort du texte', () => {
    it('met le code à six chiffres dans son cadre, espacé', () => {
      const html = rendre('Voici le code.\n\n483920\n\nIl expire vite.');

      expect(html).toContain('letter-spacing:10px');
      expect(html).toContain('483920');
    });

    /*
     * ⚠️ UN MOT DE PASSE N'EST PAS ESPACÉ : la valeur est sensible à la casse,
     * et l'espacement des lettres la rend plus difficile à lire et à recopier.
     */
    it('met le mot de passe dans son cadre, SANS espacement', () => {
      const html = rendre('Votre mot de passe :\n\nAa1xK9mQz2\n\nChangez-le.');

      expect(html).toContain('Aa1xK9mQz2');
      expect(html).not.toContain('letter-spacing');
    });

    it('laisse une phrase ordinaire en paragraphe', () => {
      const html = rendre('Bonjour.\n\nVotre compte est activé.');

      expect(html).not.toContain('border-radius:8px');
    });
  });

  /*
   * ⚠️ LA SIGNATURE NE PARAÎT PAS EN HTML : la maquette n'en a pas, et le pied
   * dit déjà de qui vient le message. Elle RESTE dans la version texte, qui n'a
   * pas de pied.
   */
  it('retire la signature du HTML, que le pied remplace', () => {
    const html = rendre("Bonjour.\n\nUn message.\n\nL'équipe EDT Pro");

    expect(html).toContain('Un message.');
    expect(html).not.toContain("L'équipe EDT Pro");
    // Le pied prend sa place : la raison, l'adresse de réponse, le copyright.
    expect(html).toContain('Une raison.');
    expect(html).toContain('Tous droits réservés');
  });

  /*
   * ⚠️ LE TITRE EST LE SUJET, pas un champ de plus : deux textes distincts
   * finiraient par se contredire, et c'est le sujet que le lecteur vient de
   * lire dans sa liste de messages.
   */
  it('reprend le sujet comme grand titre', () => {
    expect(rendre('Bonjour.')).toMatch(/<h1[^>]*>\s*Sujet du message\s*<\/h1>/);
  });

  /*
   * ═══ ⚠️ NI BOUTON, NI LIENS, NI SECOND LOGO ═══
   * Le gabarit Slack n'a pas de bouton ; le porteur a écarté les réseaux
   * sociaux — le produit n'a pas de comptes — puis le second logo et les pages
   * légales, remplacés par un simple filet pointillé. Un lien mort vaut moins
   * que son absence : ce test tombe si on en réintroduit un sans y penser.
   */
  describe('le pied', () => {
    it("n'est qu'un filet pointillé : aucun lien, aucun second logo", () => {
      const html = rendre('Bonjour.');

      expect(html).toContain('border-top:1px dashed');
      // Le seul lien du message reste l'adresse de réponse.
      expect([...html.matchAll(/<a href="(http[^"]+)"/g)]).toHaveLength(0);
      expect(html).not.toMatch(/twitter|facebook|linkedin|instagram/i);
      // Un seul logo : celui de l'en-tête.
      expect([...html.matchAll(/<img /g)]).toHaveLength(1);
    });

    it('dit pourquoi le message a été reçu et comment répondre', () => {
      const html = rendre('Bonjour.', 'Une raison précise.');

      expect(html).toContain('Une raison précise.');
      expect(html).toContain('mailto:');
    });
  });

  /*
   * ⚠️ CE QUI SUIT LA VALEUR EST UNE NOTE : « valable 15 minutes », « si ce
   * n'est pas vous… ». C'est la POSITION qui les désigne — aucun champ n'a à le
   * déclarer, et le texte reste la source unique.
   */
  it('met en petit ce qui suit la valeur', () => {
    const html = rendre('Voici le code.\n\n483920\n\nIl expire dans 15 minutes.');
    const note = /<p style="([^"]*)">Il expire dans 15 minutes\./.exec(html)?.[1];

    expect(note).toContain('font-size:14px');
  });

  /*
   * ⚠️ SANS VALEUR, TOUT RESTE EN CORPS : le message de changement de statut n'a
   * qu'une phrase, et la rendre en note la ferait passer pour une mention
   * légale.
   */
  it('laisse en corps un message sans valeur à recopier', () => {
    const html = rendre('Bonjour.\n\nVotre compte a été approuvé.');
    const phrase = /<p style="([^"]*)">Votre compte a été approuvé\./.exec(html)?.[1];

    expect(phrase).toContain('font-size:20px');
  });

  /*
   * ⚠️ OUTLOOK REND LE HTML AVEC LE MOTEUR DE WORD : ni flex, ni grid. La mise
   * en page doit rester en tableaux, et la police être déclarée sur les textes
   * — posée sur le seul `body`, tout retombe en Times (constaté à l'écran).
   */
  it('reste compatible Outlook : tableaux, pas de flex ni de grid', () => {
    const html = rendre('Bonjour.');

    expect(html).toContain('<table role="presentation"');
    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
  });

  it('déclare la police sur les paragraphes, pas seulement sur le corps', () => {
    const html = rendre('Bonjour.');
    const paragraphe = /<p style="[^"]*font-size:20px[^"]*"/.exec(html)?.[0];

    expect(paragraphe).toContain('font-family');
  });

  /* Une police web ne se charge pas dans un courriel : Gmail ignore @font-face. */
  it("n'essaie pas de charger une police web", () => {
    expect(rendre('Bonjour.')).not.toContain('@font-face');
  });

  it('échappe le contenu, qui vient des données', () => {
    const html = rendre('Bonjour <script>alert(1)</script>,\n\nUn message.');

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  /*
   * ⚠️ L'APERÇU DE LA LISTE DES MESSAGES : sans lui, les clients y recopient le
   * premier texte venu — souvent « Bonjour <nom> », qui n'apprend rien.
   */
  it("porte un aperçu pour la liste des messages", () => {
    expect(rendre('Bonjour.')).toContain('display:none;overflow:hidden');
  });
});
