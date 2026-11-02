import { useEffect, useId, useRef } from 'react';

/**
 * ═══ LE CIEL ANIMÉ DE LA PAGE D'ACCUEIL (2026-11-01, demande du porteur) ═══
 * « Le fond de Codex est naturel, réaliste et animé — je veux un ciel. » Un shader WebGL :
 * des nuages en bruit fractal (fbm, champ déformé sur lui-même) dérivent lentement sur un
 * ciel du bleu d'EDT Pro, ombrés du gris de la marque, une touche de vert vers l'horizon.
 * Aucune vidéo, aucune dépendance : quelques dizaines de lignes, calculées par la carte graphique.
 *
 * ⚠️ VERSION RETENUE PAR LE PORTEUR : quatre variantes essayées ensuite (cirrus « ultra
 *    réalistes », nuages en volume, ciel photographique à cumulus, volutes soyeuses façon Codex)
 *    ont été refusées — « retourne à cette version ».
 *
 * ═══ ET SES CUMULUS (2026-11-02, demande du porteur : « combine-le avec ce fond pour le rendre
 * plus réaliste ») ═══ Par-dessus ce ciel, six cumulus repris du `CloudShader` d'Aceternity UI
 * fourni par le porteur : enveloppe en dôme à base plate, remplie d'un bruit « billow » déformé
 * (sommets en chou-fleur), ombrés par un second échantillon pris au-dessus (le soleil est en
 * haut), liseré d'argent sur les bords minces, et la perspective : les lointains, petits et
 * lents, se fondent dans le ciel ; les proches, grands, filent plus vite. Ils sont placés par
 * rapport au PREMIER ÉCRAN (`u_ecran`), pas à la section entière, qui le dépasse.
 *
 * ⚠️ PAS LE `CloudShader` LUI-MÊME (essayé le même jour, puis écarté par le porteur : « il
 *    ralentit ») : pleine résolution, 60 images/s, jamais en pause — 52 ms par image sur une
 *    Intel UHD 620. Ses nuages, repris ici, coûtent 3,5 ms.
 *
 * ⚠️ SOBRE PAR CONSTRUCTION :
 *   - rendu à 42 % de la résolution, 30 images par seconde au plus — mesuré à 3,5 ms par image
 *     sur une Intel UHD 620 (1440 × 900), cumulus compris ;
 *   - arrêté hors de l'écran (IntersectionObserver) et onglet caché (requestAnimationFrame) ;
 *   - figé sur une seule image si le visiteur demande moins d'animations ;
 *   - sans WebGL, le dégradé CSS posé dessous reste seul — la page ne dépend pas du shader.
 */

const SOMMETS = `
attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAGMENTS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_taille;
uniform float u_temps;
uniform float u_ecran; // hauteur du premier écran, en pixels de la toile

float hasard(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float bruit(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hasard(i), hasard(i + vec2(1.0, 0.0)), u.x),
             mix(hasard(i + vec2(0.0, 1.0)), hasard(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    v += a * bruit(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

// ── Les cumulus (d'après le CloudShader d'Aceternity UI) ──────────────────
const mat2 TOURNE = mat2(0.80, 0.60, -0.60, 0.80);
const vec3 BLANC_NUAGE = vec3(0.984, 0.973, 0.949);

float hasardC(vec2 p) { return fract(sin(dot(p, vec2(41.31, 289.17))) * 26737.367); }

float bruitC(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hasardC(i), hasardC(i + vec2(1.0, 0.0)), f.x),
             mix(hasardC(i + vec2(0.0, 1.0)), hasardC(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbmC(vec2 p) {
  float somme = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { somme += a * bruitC(p); p = TOURNE * p * 2.03 + 19.19; a *= 0.5; }
  return somme;
}

// Des crêtes nettes et gonflées : le sommet en chou-fleur d'un cumulus.
float billow(vec2 p) {
  float somme = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { somme += a * (1.0 - abs(2.0 * bruitC(p) - 1.0)); p = TOURNE * p * 2.11 + 13.37; a *= 0.5; }
  return somme;
}

// Densité d'un nuage : dôme au-dessus du centre, base plate dessous, détail déformé.
float densite(vec2 p, vec2 c, vec2 r, float graine, float t) {
  vec2 q = p - c;
  float ry = q.y > 0.0 ? r.y : r.y * 0.42;
  float enveloppe = 1.0 - length(vec2(q.x / r.x, q.y / ry));
  if (enveloppe < -0.35) return 0.0;
  vec2 dp = q * (2.4 / r.x) + graine;
  dp += 0.6 * vec2(fbmC(dp * 1.4 + t * 0.04), fbmC(dp * 1.4 + 7.7 - t * 0.03));
  return enveloppe + (billow(dp * 1.6) - 0.62) * 0.62;
}

vec3 nuageSur(vec3 couleur, vec3 ciel, vec2 p, vec2 c, vec2 r, float graine, float t, float loin) {
  float d = densite(p, c, r, graine, t);
  if (d < 0.02) return couleur;
  // Le soleil est en haut : plus il y a de nuage au-dessus, plus ce point est dans l'ombre.
  float dessus = densite(p + vec2(0.0, r.y * 0.55), c, r, graine, t);
  float ombre = clamp((dessus - d) * 1.1 + d * 0.55, 0.0, 1.0);
  vec3 eclaire = BLANC_NUAGE * 1.04;
  vec3 sombre = mix(BLANC_NUAGE * 0.66, ciel, 0.38);
  vec3 c2 = mix(eclaire, sombre, ombre * 0.8);
  float alpha = smoothstep(0.02, 0.38, d);
  c2 += (smoothstep(0.02, 0.14, d) * (1.0 - smoothstep(0.14, 0.40, d))) * 0.10; // liseré d'argent
  c2 = mix(c2, ciel, loin * 0.35);                                              // perspective
  alpha *= mix(1.0, 0.8, loin);
  return mix(couleur, c2, alpha);
}

// Un nuage qui traverse l'écran et revient, en se balançant à peine.
vec3 passage(vec3 couleur, vec3 ciel, vec2 p, float largeur, float t,
             float vitesse, float phase, float y, vec2 r, float graine, float loin) {
  float cx = mix(-r.x - 0.25, largeur + r.x + 0.25, fract(t * vitesse + phase));
  float cy = y + sin(t * 0.05 + phase * 6.2831) * 0.012;
  return nuageSur(couleur, ciel, p, vec2(cx, cy), r, graine, t, loin);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_taille;
  vec2 p = uv * vec2(u_taille.x / u_taille.y, 1.0) * 1.6;
  float t = u_temps * 0.018;

  // Le ciel : blanc bleuté à l'horizon (bas), bleu EDT Pro en altitude (haut).
  vec3 horizon = vec3(0.88, 0.94, 1.0);
  vec3 milieu  = vec3(0.56, 0.77, 0.97);
  vec3 zenith  = vec3(0.30, 0.58, 0.93);
  vec3 ciel = mix(horizon, milieu, smoothstep(0.0, 0.62, uv.y));
  // ⚠️ Le haut reste CLAIR à gauche, là où sont le logo et la navigation, en texte foncé.
  ciel = mix(ciel, zenith, smoothstep(0.5, 1.1, uv.y) * smoothstep(0.1, 0.9, uv.x) * 0.8);
  // Une brume verte, très légère, vers l'horizon de droite (le vert de la marque).
  ciel = mix(ciel, vec3(0.80, 0.92, 0.84), smoothstep(0.55, 0.0, uv.y) * smoothstep(0.35, 1.0, uv.x) * 0.38);

  // Les nuages : un champ fractal déformé par lui-même, qui dérive vers la droite.
  vec2 q = vec2(fbm(p + vec2(t, 0.0)), fbm(p + vec2(5.2, 1.3) - vec2(t * 0.6, 0.0)));
  float n = fbm(p + 2.0 * q + vec2(t * 1.5, t * 0.25));
  float couverture = smoothstep(0.34, 0.72, n);
  // L'ombre, tirée du même champ (pas de quatrième calcul) : le cœur dense des nuages est blanc,
  // leurs bords et le dessous, là où la déformation q plonge, prennent le gris de la marque.
  vec3 gris = vec3(0.80, 0.81, 0.81); // #CDCFCE
  float ombre = clamp((0.62 - n) * 2.4 + (0.5 - q.y) * 1.2, 0.0, 1.0);
  vec3 nuage = mix(vec3(1.0), gris, ombre * 0.75);
  // ⚠️ Un VOILE léger, plus une nappe (2026-11-02, demande du porteur : « diminue l'effet blanc ») :
  //    ce sont les cumulus, par-dessus, qui font les nuages.
  vec3 couleur = mix(ciel, nuage, couverture * 0.3);

  // Un halo de lumière, haut et au centre, derrière le titre.
  couleur += vec3(1.0, 0.99, 0.96) * 0.08 * exp(-5.0 * length((uv - vec2(0.5, 0.78)) * vec2(1.4, 1.0)));

  // ── Les cumulus, dans le repère du PREMIER ÉCRAN (0 en bas de l'écran, 1 en haut) ──
  vec2 e = vec2(gl_FragCoord.x, gl_FragCoord.y - (u_taille.y - u_ecran)) / u_ecran;
  float largeur = u_taille.x / u_ecran;
  float tc = u_temps;
  vec3 fond = couleur;
  // Lointains : petits, hauts, lents.
  couleur = passage(couleur, fond, e, largeur, tc, 0.006, 0.10, 0.84, vec2(0.20, 0.10), 43.7, 1.0);
  couleur = passage(couleur, fond, e, largeur, tc, 0.008, 0.62, 0.73, vec2(0.24, 0.12), 71.3, 0.85);
  // Milieu.
  couleur = passage(couleur, fond, e, largeur, tc, 0.011, 0.33, 0.60, vec2(0.34, 0.16), 17.3, 0.55);
  couleur = passage(couleur, fond, e, largeur, tc, 0.013, 0.80, 0.47, vec2(0.30, 0.15), 29.9, 0.45);
  // Proches : grands, bas, plus rapides.
  couleur = passage(couleur, fond, e, largeur, tc, 0.016, 0.05, 0.35, vec2(0.46, 0.20), 91.1, 0.15);
  couleur = passage(couleur, fond, e, largeur, tc, 0.020, 0.48, 0.20, vec2(0.56, 0.24), 57.2, 0.0);

  gl_FragColor = vec4(clamp(couleur, 0.0, 1.0), 1.0);
}
`;

function compiler(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Résolution de rendu, en part des pixels CSS : 42 % — assez pour les bords floconneux des
 *  cumulus, sans payer la pleine résolution. */
const ECHELLE = 0.42;

export default function CielAnime({ className = '' }) {
  const toile = useRef(null);
  // Un identifiant de filtre par ciel : la page en porte deux.
  const grain = `grain-ciel-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    const canvas = toile.current;
    const gl = canvas?.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!gl) return undefined; // le dégradé CSS reste seul

    const programme = gl.createProgram();
    const vs = compiler(gl, gl.VERTEX_SHADER, SOMMETS);
    const fs = compiler(gl, gl.FRAGMENT_SHADER, FRAGMENTS);
    if (!vs || !fs) return undefined;
    gl.attachShader(programme, vs);
    gl.attachShader(programme, fs);
    gl.linkProgram(programme);
    if (!gl.getProgramParameter(programme, gl.LINK_STATUS)) return undefined;
    gl.useProgram(programme);

    const tampon = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tampon);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(programme, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uTaille = gl.getUniformLocation(programme, 'u_taille');
    const uTemps = gl.getUniformLocation(programme, 'u_temps');
    const uEcran = gl.getUniformLocation(programme, 'u_ecran');

    const dimensionner = () => {
      const largeur = Math.max(1, Math.round(canvas.clientWidth * ECHELLE));
      const hauteur = Math.max(1, Math.round(canvas.clientHeight * ECHELLE));
      if (canvas.width !== largeur || canvas.height !== hauteur) {
        canvas.width = largeur;
        canvas.height = hauteur;
        gl.viewport(0, 0, largeur, hauteur);
      }
      gl.uniform2f(uTaille, largeur, hauteur);
      // Les cumulus sont placés par rapport au premier écran, pas à la section (qui le dépasse).
      gl.uniform1f(uEcran, Math.max(1, Math.min(window.innerHeight, canvas.clientHeight) * ECHELLE));
    };

    // Un départ décalé : la première image montre déjà un ciel formé.
    const depart = performance.now() - 40000;
    const dessiner = (maintenant) => {
      dimensionner();
      gl.uniform1f(uTemps, (maintenant - depart) / 1000);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const calme = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let image = 0;
    let visible = true;
    let derniere = 0;
    const boucle = (maintenant) => {
      // 30 images par seconde suffisent à une dérive de nuages, et ménagent la carte graphique.
      if (maintenant - derniere >= 33) {
        derniere = maintenant;
        dessiner(maintenant);
      }
      image = visible && !calme ? requestAnimationFrame(boucle) : 0;
    };
    // Une première image tout de suite : le ciel est là même si l'animation tarde à démarrer
    // (onglet en arrière-plan, où `requestAnimationFrame` attend).
    dessiner(performance.now());
    image = requestAnimationFrame(boucle);

    const observateur = new IntersectionObserver(([entree]) => {
      visible = entree.isIntersecting;
      if (visible && !image && !calme) image = requestAnimationFrame(boucle);
    });
    observateur.observe(canvas);
    const redimension = new ResizeObserver(() => calme && dessiner(performance.now()));
    redimension.observe(canvas);

    return () => {
      cancelAnimationFrame(image);
      observateur.disconnect();
      redimension.disconnect();
      gl.deleteBuffer(tampon);
      gl.deleteProgram(programme);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      {/* Le ciel sans WebGL : le même dégradé, figé. */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#9cc6f5] via-[#cfe4fb] to-[#f0f6ff]" />
      <canvas ref={toile} className="absolute inset-0 h-full w-full" />
      {/* Le grain d'une photo : sans lui, un dégradé calculé paraît « numérique ». */}
      <svg className="absolute inset-0 h-full w-full opacity-[0.07] mix-blend-overlay">
        <filter id={grain}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#${grain})`} />
      </svg>
    </div>
  );
}
