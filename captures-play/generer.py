# Visuels Play Store d'EDT Pro (2026-11-01). Dessinés en HTML, rendus par Chrome sans fenêtre (skill
# logo-design), puis enregistrés en PNG dans `sortie/`. Relancer :  python captures-play/generer.py
#
# Style « téléphone droit » (d'après les visuels Glovo fournis par le porteur) : fond bleu à taches claires,
# grand titre centré, appareil droit, un élément DE L'ÉCRAN agrandi qui déborde de l'appareil.
import base64
import os
import sys
from pathlib import Path

from PIL import Image

ICI = Path(__file__).resolve().parent
RACINE = ICI.parent
sys.path.insert(0, str(Path.home() / '.claude/skills/logo-design/scripts'))
from render_png import screenshot_html  # noqa: E402  (Chrome sans fenêtre, fourni par le skill logo-design)

BLEU, VERT = '#0071DB', '#489C5A'


def data_uri(chemin):
    mime = 'image/png'
    return f'data:{mime};base64,' + base64.b64encode(Path(chemin).read_bytes()).decode()


# ═══ LES VISUELS « TÉLÉPHONE » ═══ Une capture Android (720 × 1600) par visuel, même format 1536 × 2048.

POLICE_INTER = RACINE / 'node_modules/@fontsource/inter/files'

# ⚠️ LES VISUELS SONT PUBLICS : le nom réel du compte de démonstration est remplacé (bandeau de l'emploi du
# temps, initiales de l'avatar). Coordonnées dans la capture d'origine (720 × 1600).
AVATAR = {'zone': (630, 84, 682, 128), 'fond': (230, 240, 249), 'texte': 'FD', 'couleur': (4, 101, 178), 'taille': 25}
MASQUES = {
    'emploi': [AVATAR, {'zone': (64, 660, 330, 696), 'fond': (230, 240, 250), 'texte': 'FORMATEUR DÉMO',
                        'couleur': (4, 101, 178), 'taille': 29, 'gauche': 71}],
    'affectations': [AVATAR],
    'documents': [AVATAR],
    'menu': [AVATAR],
    'connexion': [],
}


def ecran_telephone(nom):
    """La capture sans la barre d'état ni la barre de navigation d'Android, noms réels masqués."""
    from PIL import ImageDraw, ImageFont
    im = Image.open(ICI / f'brut/{nom}.png').convert('RGB')
    dessin = ImageDraw.Draw(im)
    for m in MASQUES[nom]:
        x1, y1, x2, y2 = m['zone']
        dessin.rectangle(m['zone'], fill=m['fond'])
        police = ImageFont.truetype(str(POLICE_INTER / 'inter-latin-600-normal.woff'), m['taille'])
        l, h_ = dessin.textbbox((0, 0), m['texte'], font=police)[2:]
        x = m.get('gauche', (x1 + x2 - l) / 2)
        dessin.text((x, (y1 + y2) / 2), m['texte'], font=police, fill=m['couleur'], anchor='lm')
    im.save(ICI / f'brut/{nom}-masque.png')
    im = im.crop((0, 55, 720, 1571))
    sortie = ICI / f'brut/{nom}-ecran.png'
    im.save(sortie)
    return sortie


BARRE_ETAT = '''<div class="etat"><span>12:00</span><span class="icones">
  <svg width="34" height="26" viewBox="0 0 24 18"><path d="M1 6a16 16 0 0 1 22 0M4.5 9.5a11 11 0 0 1 15 0M8 13a6 6 0 0 1 8 0"
    fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16" r="1.6" fill="#111"/></svg>
  <svg width="30" height="26" viewBox="0 0 20 18"><path d="M1 17h3v-4H1zM6 17h3V10H6zM11 17h3V6h-3zM16 17h3V2h-3z" fill="#111"/></svg>
  <svg width="46" height="24" viewBox="0 0 30 16"><rect x="1" y="1" width="25" height="14" rx="4" fill="none" stroke="#111" stroke-width="2"/>
    <rect x="4" y="4" width="17" height="8" rx="2" fill="#111"/><rect x="27.5" y="5" width="2" height="6" rx="1" fill="#111"/></svg>
</span></div>'''

# ═══ LE STYLE « TÉLÉPHONE DROIT » ═══ (2026-11-01, d'après les visuels Glovo fournis par le porteur.) Téléphone
# droit, centré, qui sort par le bas ; grand titre centré ; un élément DE L'ÉCRAN, agrandi, qui déborde des deux
# côtés du téléphone. Format téléphone de Google Play : 1080 × 1920 (9:16).
LT, HT = 1080, 1920
L_ECRAN = 740                      # largeur de l'écran dans le téléphone


def extrait(nom, zone):
    """Un morceau de la capture (coordonnées de la capture d'origine), noms réels déjà masqués."""
    ecran_telephone(nom)
    im = Image.open(ICI / f'brut/{nom}-masque.png')
    sortie = ICI / f'brut/{nom}-extrait.png'
    im.crop(zone).save(sortie)
    return sortie


def notification(icone, titre, texte):
    """Une notification comme Android l'affiche."""
    return f'''<div class="notif"><div class="tete"><img src="{icone}"><span>EDT Pro · maintenant</span></div>
      <div class="nt">{titre}</div><div class="nx">{texte}</div></div>'''


def visuel_droit(nom, titre, doux, sortant, haut_sortant):
    """`sortant` : l'élément agrandi (HTML) ; `haut_sortant` : son bord haut dans le visuel."""
    ecran = ecran_telephone(nom)
    police = POLICE_INTER.as_uri()
    h_ecran = round(L_ECRAN * 1516 / 720)
    l_tel = L_ECRAN + 44
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Inter; font-weight: 600; src: url('{police}/inter-latin-600-normal.woff2'); }}
@font-face {{ font-family: Inter; font-weight: 800; src: url('{police}/inter-latin-800-normal.woff2'); }}
* {{ box-sizing: border-box; margin: 0; }}
html, body {{ width: {LT}px; height: {HT}px; overflow: hidden; }}
body {{ background: {BLEU}; font-family: Inter, sans-serif; position: relative; }}
.taches {{ position: absolute; inset: 0; }}
.titre {{ position: absolute; left: 60px; right: 60px; top: 110px; text-align: center; color: #fff; font-weight: 800;
          font-size: 92px; line-height: 1.1; letter-spacing: -2.5px; }}
.titre .accent {{ background: {VERT}; border-radius: 18px; padding: 0 18px; box-decoration-break: clone;
                  -webkit-box-decoration-break: clone; }}
.titre .doux {{ display: block; font-weight: 600; font-size: 40px; line-height: 1.32; letter-spacing: -.3px;
                margin: 30px auto 0; opacity: .92; max-width: 900px; }}
.telephone {{ position: absolute; left: {(LT - l_tel) / 2}px; top: 640px; width: {l_tel}px; padding: 22px;
              background: #0f1115; border-radius: 104px; box-shadow: 0 60px 120px rgba(0, 20, 60, .45),
              inset 0 0 0 4px #2a2e36; }}
.telephone .ecran {{ width: {L_ECRAN}px; border-radius: 84px; overflow: hidden; background: #fff; }}
.telephone .ecran img {{ width: {L_ECRAN}px; height: {h_ecran}px; display: block; }}
.etat {{ height: 72px; display: flex; align-items: center; justify-content: space-between; padding: 8px 60px 0;
         font-size: 32px; font-weight: 600; color: #111; background: #fff; }}
.etat .icones {{ display: flex; gap: 12px; align-items: center; }}
.sortant {{ position: absolute; left: 50px; right: 50px; top: {haut_sortant}px; background: #fff; border-radius: 36px;
            overflow: hidden; box-shadow: 0 40px 90px rgba(0, 20, 60, .40); }}
.sortant > img {{ width: 100%; display: block; }}
.notif {{ padding: 34px 40px 40px; }}
.notif .tete {{ display: flex; align-items: center; gap: 18px; font-size: 30px; font-weight: 600; color: #6b7280; }}
.notif .tete img {{ width: 56px; height: 56px; border-radius: 14px; }}
.notif .nt {{ font-size: 46px; font-weight: 800; color: #111827; margin-top: 20px; letter-spacing: -.5px; }}
.notif .nx {{ font-size: 38px; font-weight: 600; color: #4b5563; margin-top: 10px; line-height: 1.3; }}
</style></head><body>
<svg class="taches" width="{LT}" height="{HT}"><g fill="#fff" fill-opacity=".09">
  <path d="M640 0H1080V760C960 820 860 700 820 560C780 420 640 380 600 240C570 140 600 60 640 0Z"/>
  <path d="M0 1180C140 1120 300 1200 340 1360C380 1520 300 1640 380 1780C420 1850 470 1890 520 1920H0Z"/>
</g></svg>
<div class="titre">{titre}<span class="doux">{doux}</span></div>
<div class="telephone"><div class="ecran">{BARRE_ETAT}<img src="{ecran.as_uri()}"></div></div>
<div class="sortant">{sortant}</div>
</body></html>'''


def visuels_telephone():
    icone = data_uri(RACINE / 'frontend/public/favicon.png')
    img = lambda nom, zone: f'<img src="{extrait(nom, zone).as_uri()}">'
    return {
        # (titre, sous-titre, élément agrandi, bord haut de l'élément)
        'emploi': ('Votre <span class="accent">emploi&nbsp;du&nbsp;temps</span> toujours à jour',
                   'Séances, salles et groupes de la semaine, et une notification à chaque changement.',
                   notification(icone, 'Emploi du temps publié', 'Semaine S9 · du 2 au 8 novembre'), 1080),
        'affectations': ('Vos <span class="accent">affectations</span> et vos masses horaires',
                         'Groupes, modules, EFM régionaux : tout est récapitulé, module par module.',
                         img('affectations', (46, 300, 656, 696)), 1000),
        'documents': ('Vos <span class="accent">documents</span> prêts à imprimer',
                      "Feuilles de présence, en-têtes de contrôle et d'EFM, fiches de réclamation.",
                      img('documents', (40, 294, 621, 688)), 980),
        'connexion': ('<span class="accent">Connexion</span> en un scan de votre carte',
                      'Les stagiaires se connectent en scannant le QR code de leur carte.',
                      img('connexion', (60, 950, 660, 1192)), 1420),
        'menu': ('Tout votre <span class="accent">établissement</span> dans la poche',
                 'Emploi, affectations, avancement, documents, absences… et une messagerie intégrée.',
                 notification(icone, 'Nouveau message · Direction', 'La réunion pédagogique est avancée à 10 h.'), 1500),
    }


def graphe_avancement():
    """La capture du graphique, élargie de 114 px de blanc à droite : son milieu tombe alors dans le vide
    entre M201 et M202 (x 994 de la capture) — la coupure entre les deux visuels ne tranche aucune barre."""
    im = Image.open(ICI / 'brut/avancement-graphe.png').convert('RGB')
    large = Image.new('RGB', (im.width + 114, im.height), (255, 255, 255))
    large.paste(im, (0, 0))
    sortie = ICI / 'brut/avancement-graphe-centre.png'
    large.save(sortie)
    return sortie, large.width / large.height


def entete_application():
    """La barre du haut de l'application (menu, logo, messagerie, thème, avatar), prise sur une capture."""
    ecran_telephone('documents')
    sortie = ICI / 'brut/entete-application.png'
    Image.open(ICI / 'brut/documents-masque.png').crop((0, 55, 720, 160)).save(sortie)
    return sortie


def planche_avancement():
    """Deux visuels 1080 × 1920 côte à côte, à la manière de Marjane (demande du porteur) : un téléphone debout,
    de la MÊME taille que sur les autres visuels, très incliné et à cheval sur la jonction — son bas dans le
    premier visuel, son haut dans le second — et le graphique agrandi, étalé sur les deux."""
    graphe, ratio = graphe_avancement()
    entete = entete_application()
    police = POLICE_INTER.as_uri()
    logo = data_uri(RACINE / 'frontend/public/logo_edtpro.png')
    l_pano = 2 * LT
    h_ecran = 72 + round(L_ECRAN * 1516 / 720)
    l_tel, h_tel = L_ECRAN + 44, h_ecran + 44
    cx, cy = LT, 1000                       # centre du téléphone : sur la jonction
    l_graphe = 1900                         # le graphique étalé ; son milieu (vide M201 | M202) sur la jonction
    haut_graphe = 990
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Inter; font-weight: 600; src: url('{police}/inter-latin-600-normal.woff2'); }}
@font-face {{ font-family: Inter; font-weight: 800; src: url('{police}/inter-latin-800-normal.woff2'); }}
* {{ box-sizing: border-box; margin: 0; }}
html, body {{ width: {l_pano}px; height: {HT}px; overflow: hidden; }}
body {{ background: {BLEU}; font-family: Inter, sans-serif; position: relative; }}
.taches {{ position: absolute; inset: 0; }}
.titre {{ position: absolute; left: 90px; top: 120px; width: 760px; color: #fff; font-weight: 800; font-size: 80px;
          line-height: 1.12; letter-spacing: -2px; }}
.titre .accent {{ background: {VERT}; border-radius: 16px; padding: 0 16px; box-decoration-break: clone;
                  -webkit-box-decoration-break: clone; }}
.marque {{ position: absolute; left: 90px; top: 610px; background: #fff; border-radius: 30px; padding: 22px 34px;
           box-shadow: 0 24px 60px rgba(0, 30, 80, .30); }}
.marque img {{ height: 104px; display: block; }}
.telephone {{ position: absolute; left: {cx - l_tel / 2}px; top: {cy - h_tel / 2}px; width: {l_tel}px; padding: 22px;
              background: #0f1115; border-radius: 104px; transform: rotate(30deg);
              box-shadow: 0 60px 120px rgba(0, 20, 60, .45), inset 0 0 0 4px #2a2e36; }}
.ecran {{ width: {L_ECRAN}px; height: {h_ecran}px; border-radius: 84px; overflow: hidden; background: #fff; }}
.etat {{ height: 72px; display: flex; align-items: center; justify-content: space-between; padding: 8px 60px 0;
         font-size: 32px; font-weight: 600; color: #111; background: #fff; }}
.etat .icones {{ display: flex; gap: 12px; align-items: center; }}
.ecran .entete {{ width: {L_ECRAN}px; display: block; border-bottom: 2px solid #eef0f3; }}
.page {{ padding: 40px 38px; }}
.page h1 {{ font-size: 46px; font-weight: 800; color: #111827; letter-spacing: -1px; }}
.page .sous {{ font-size: 22px; font-weight: 600; color: #6b7280; margin-top: 10px; }}
.taux {{ margin-top: 28px; border: 2px solid #eceef1; border-radius: 22px; padding: 24px 26px; }}
.taux .chiffre {{ font-size: 54px; font-weight: 800; color: #111827; letter-spacing: -1px; }}
.taux .chiffre small {{ font-size: 22px; font-weight: 600; color: #6b7280; letter-spacing: 0; margin-left: 12px; }}
.taux .total {{ font-size: 24px; font-weight: 600; color: #6b7280; margin-top: 6px; }}
.taux .barre {{ height: 16px; border-radius: 8px; background: #eceef1; margin-top: 18px; overflow: hidden; }}
.taux .barre div {{ width: 21.9%; height: 100%; background: #2a9d8f; }}
.page .mini {{ width: 100%; display: block; margin-top: 30px; border: 2px solid #eceef1; border-radius: 18px; }}
/* Le graphique incliné (demande du porteur). Pivot : le vide entre M201 et M202 (milieu de l'image élargie), à
   hauteur des barres (y 510 de la capture) — la jonction des deux visuels y passe encore, sans trancher de barre. */
.graphe {{ position: absolute; left: {(l_pano - l_graphe) / 2}px; top: {haut_graphe}px; width: {l_graphe}px; background: #fff;
           border-radius: 36px; padding: 18px; box-shadow: 0 44px 100px rgba(0, 20, 60, .45); transform: rotate(9deg);
           transform-origin: {l_graphe / 2}px {18 + 510 * (l_graphe - 36) / round(784 * ratio)}px; }}
.graphe img {{ width: 100%; display: block; }}
</style></head><body>
<svg class="taches" width="{l_pano}" height="{HT}"><g fill="#fff" fill-opacity=".09">
  <path d="M1500 0H2160V640C2040 690 1920 600 1860 480C1800 360 1640 330 1560 220C1510 150 1490 70 1500 0Z"/>
  <path d="M0 1340C140 1280 300 1360 340 1500C370 1610 330 1720 400 1820C430 1860 470 1900 510 1920H0Z"/>
</g></svg>
<div class="titre">Téléchargez l'app EDT Pro et suivez <span class="accent">l'avancement</span> de vos modules</div>
<div class="marque"><img src="{logo}" alt="EDT Pro"></div>
<div class="telephone"><div class="ecran">{BARRE_ETAT}<img class="entete" src="{entete.as_uri()}">
  <div class="page"><h1>Suivi de l'avancement</h1>
    <div class="sous">D'après les séances terminées au 1 novembre à 12h34.</div>
    <div class="taux"><div class="chiffre">21,9 %<small>Taux d'avancement</small></div>
      <div class="total">210 / 960 h · 10 module(s)</div><div class="barre"><div></div></div></div>
    <img class="mini" src="{graphe.as_uri()}"></div>
</div></div>
<div class="graphe"><img src="{graphe.as_uri()}"></div>
</body></html>'''


def banniere():
    """La bannière du Play Store (« image de présentation », 1024 × 500 exigé) : dessinée au double, puis réduite."""
    ecran = ecran_telephone('emploi')
    police = POLICE_INTER.as_uri()
    logo = data_uri(RACINE / 'frontend/public/logo_edtpro.png')
    icone = data_uri(RACINE / 'frontend/public/favicon.png')
    l_ecran = 560
    h_ecran = round(l_ecran * 1516 / 720)
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
@font-face {{ font-family: Inter; font-weight: 600; src: url('{police}/inter-latin-600-normal.woff2'); }}
@font-face {{ font-family: Inter; font-weight: 800; src: url('{police}/inter-latin-800-normal.woff2'); }}
* {{ box-sizing: border-box; margin: 0; }}
html, body {{ width: 2048px; height: 1000px; overflow: hidden; }}
body {{ background: {BLEU}; font-family: Inter, sans-serif; position: relative; }}
.taches {{ position: absolute; inset: 0; }}
.marque {{ position: absolute; left: 120px; top: 120px; background: #fff; border-radius: 30px; padding: 22px 34px;
           box-shadow: 0 24px 60px rgba(0, 30, 80, .30); }}
.marque img {{ height: 104px; display: block; }}
.titre {{ position: absolute; left: 120px; top: 330px; width: 1080px; color: #fff; font-weight: 800; font-size: 84px;
          line-height: 1.1; letter-spacing: -2px; }}
.titre .accent {{ background: {VERT}; border-radius: 16px; padding: 0 16px; }}
.titre .doux {{ display: block; font-weight: 600; font-size: 38px; letter-spacing: -.3px; margin-top: 28px; opacity: .92; }}
.telephone {{ position: absolute; left: 1330px; top: 110px; width: {l_ecran + 36}px; padding: 18px; background: #0f1115;
              border-radius: 84px; box-shadow: 0 50px 100px rgba(0, 20, 60, .45), inset 0 0 0 3px #2a2e36; }}
.telephone .ecran {{ width: {l_ecran}px; border-radius: 68px; overflow: hidden; background: #fff; }}
.telephone .ecran img {{ width: {l_ecran}px; height: {h_ecran}px; display: block; }}
.etat {{ height: 56px; display: flex; align-items: center; justify-content: space-between; padding: 6px 48px 0;
         font-size: 26px; font-weight: 600; color: #111; background: #fff; }}
.etat .icones {{ display: flex; gap: 10px; align-items: center; transform: scale(.8); transform-origin: right center; }}
.notif {{ position: absolute; left: 1170px; top: 560px; width: 620px; background: #fff; border-radius: 30px;
          padding: 26px 32px 30px; box-shadow: 0 36px 80px rgba(0, 20, 60, .40); }}
.notif .tete {{ display: flex; align-items: center; gap: 14px; font-size: 24px; font-weight: 600; color: #6b7280; }}
.notif .tete img {{ width: 44px; height: 44px; border-radius: 11px; }}
.notif .nt {{ font-size: 36px; font-weight: 800; color: #111827; margin-top: 14px; letter-spacing: -.4px; }}
.notif .nx {{ font-size: 30px; font-weight: 600; color: #4b5563; margin-top: 6px; }}
</style></head><body>
<svg class="taches" width="2048" height="1000"><g fill="#fff" fill-opacity=".09">
  <path d="M1180 0H2048V420C1900 470 1780 360 1700 240C1620 120 1420 140 1300 60C1250 30 1210 10 1180 0Z"/>
  <path d="M0 700C160 640 330 700 380 820C410 900 470 960 520 1000H0Z"/>
</g></svg>
<div class="marque"><img src="{logo}" alt="EDT Pro"></div>
<div class="titre">L'<span class="accent">emploi&nbsp;du&nbsp;temps</span><br>de votre établissement,<br>dans la poche
  <span class="doux">Emploi du temps · avancement · documents · messagerie</span></div>
<div class="telephone"><div class="ecran">{BARRE_ETAT}<img src="{ecran.as_uri()}"></div></div>
<div class="notif"><div class="tete"><img src="{icone}"><span>EDT Pro · maintenant</span></div>
  <div class="nt">Emploi du temps publié</div><div class="nx">Semaine S9 · du 2 au 8 novembre</div></div>
</body></html>'''


def main():
    sortie = ICI / 'sortie'
    sortie.mkdir(exist_ok=True)
    html = ICI / 'planche-avancement.html'
    html.write_text(planche_avancement(), encoding='utf-8')
    pano = sortie / 'planche-avancement.png'
    screenshot_html(str(html), str(pano), 2 * LT, HT)
    im = Image.open(pano).convert('RGB')
    for i in range(2):
        im.crop((i * LT, 0, (i + 1) * LT, HT)).save(sortie / f'avancement-{i + 1}.png', optimize=True)
    print('écrit :', *(sortie / f'avancement-{i + 1}.png' for i in range(2)))

    for nom, (titre, doux, sortant, haut) in visuels_telephone().items():
        page = ICI / f'visuel-{nom}.html'
        page.write_text(visuel_droit(nom, titre, doux, sortant, haut), encoding='utf-8')
        png = sortie / f'{nom}.png'
        screenshot_html(str(page), str(png), LT, HT)
        Image.open(png).convert('RGB').save(png, optimize=True)
        print('écrit :', png)

    page = ICI / 'banniere.html'
    page.write_text(banniere(), encoding='utf-8')
    png = sortie / 'banniere.png'
    screenshot_html(str(page), str(png), 2048, 1000)
    Image.open(png).convert('RGB').resize((1024, 500), Image.LANCZOS).save(png, optimize=True)
    print('écrit :', png)


if __name__ == '__main__':
    main()
