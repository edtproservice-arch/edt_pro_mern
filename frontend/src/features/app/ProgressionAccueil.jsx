import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { chargerAvancement } from '@/features/avancement/api';
import GrapheProgression, {
  cadrer,
  COULEURS_PROGRESSION,
  COULEUR_VACANCES,
} from '@/features/avancement/GrapheProgression';
import { nombre } from '@/lib/nombres';

/**
 * L'avancement de l'établissement face au rythme régional, ZOOMÉ sur les
 * semaines qui entourent celle en cours. (Demande du porteur, 2026-08-31.)
 *
 * ═══ ⚠️ POURQUOI ZOOMÉ, ET PAS L'ANNÉE ENTIÈRE ═══
 * La page Avancement montre les trente-neuf semaines : on y vient pour juger une
 * trajectoire. L'accueil répond à une autre question — « où en sommes-nous
 * MAINTENANT ? » — et sur 39 colonnes, les deux ou trois semaines qui comptent
 * tiennent dans quelques pixels. La fenêtre les rend lisibles, et l'axe des taux
 * se resserre avec elle.
 *
 * ⚠️ LE MÊME COMPOSANT QUE LA PAGE AVANCEMENT, cadré autrement : deux tracés
 * séparés auraient divergé au premier ajustement de couleur ou de règle.
 *
 * ⚠️ AUCUNE ROUTE NOUVELLE, et la MÊME clé de cache `['avancement']` que la page
 * dédiée — c'est la règle posée pour les tuiles de l'accueil : dès qu'on a
 * ouvert l'un des deux écrans, l'autre ne coûte plus rien.
 */

/**
 * TROIS semaines : la précédente, celle en cours, la suivante (demande du
 * porteur, 2026-09-01 — remplace la fenêtre de douze).
 *
 * ⚠️ C'EST L'ÉCART DU MOMENT QU'ON VIENT LIRE, pas une trajectoire. Sur douze
 * semaines, les onze autres n'ajoutaient rien à la question « où en sommes-nous
 * aujourd'hui ? » — elles écrasaient au contraire les trois qui comptent, et
 * l'échelle des taux se calait sur la fin de la fenêtre plutôt que sur le
 * présent. L'année entière reste à un clic, par « Voir l'année entière ».
 *
 * ⚠️ `cadrer()` CENTRE sur la semaine en cours et DÉCALE aux bords de l'année
 * plutôt que de rogner : en S1, la fenêtre rend S1 · S2 · S3, jamais une
 * demi-fenêtre — c'est-à-dire précisément à la rentrée, quand on regarde cet
 * écran le plus souvent.
 */
const FENETRE = 3;

export default function ProgressionAccueil() {
  const requete = useQuery({
    /* ⚠️ LA MÊME CLÉ QUE LA PAGE AVANCEMENT, date comprise : c'est ce qui rend
       le cache commun aux deux écrans. `null` = l'état courant. */
    queryKey: ['avancement', null],
    queryFn: () => chargerAvancement(),
    retry: false,
  });

  const progression = requete.data?.progression ?? [];
  const regional = requete.data?.regional ?? null;

  /*
   * ⚠️ LA SEMAINE EN COURS VIENT DU SERVEUR — le même champ que la page
   * Avancement, pour que les deux écrans ne désignent pas deux semaines
   * différentes. Elle était DÉDUITE du rythme régional, qui ne monte pas pendant
   * les vacances : la déduction rendait alors la semaine précédente.
   */
  const semaineCourante = requete.data?.semaineCourante ?? null;
  const courante = progression.find((point) => point.numero === semaineCourante) ?? null;

  /*
   * ⚠️ RIEN PLUTÔT QU'UN CADRE VIDE : sans base, sans calendrier ou en cours de
   * chargement, ce bloc n'a rien à dire. Un squelette permanent sur l'accueil
   * ferait croire à une panne les jours où l'établissement n'a rien configuré.
   */
  if (!regional || progression.length === 0) return null;

  /* Les points réellement montrés, pour ne nommer la bande que si on la voit. */
  const fenetreEnVacances = cadrer(progression, courante, FENETRE).some((point) => point.vacances);

  const atteint = courante?.avancement ?? 0;
  const ecart = Math.round((atteint - regional.taux) * 10) / 10;

  /*
   * ⚠️ LE TITRE ET LE LIEN SONT DANS LE CADRE (demande du porteur, 2026-08-31),
   * et non au-dessus comme « Liens rapides » ou « Récents ». Ils décrivent le
   * GRAPHE, pas une section de la page : posés dehors, ils s'en détachaient et
   * le cadre s'ouvrait sur un chiffre sans énoncé. C'est aussi la disposition de
   * la page Avancement, où titre et écart partagent la première ligne du cadre.
   *
   * ⚠️ UN COMMENTAIRE JSX NE PEUT PAS PRÉCÉDER L'ÉLÉMENT RACINE dans un
   * `return (…)` : celui-ci attend une EXPRESSION, et `{/* … *\/}` y est un bloc.
   * Même piège que dans une expression `&&`, déjà rencontré sur le graphe.
   */
  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium">Avancement face au rythme régional</h2>

        {/* ⚠️ LE LIEN VERS LA VUE COMPLÈTE : ce bloc ne montre qu'une fenêtre, et
            rien d'autre ne dirait où voir l'année entière. */}
        <Link
          to="/app/avancement"
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Voir l’année entière
          <ArrowUpRight className="size-3" />
        </Link>
      </div>

      <p className="mt-0.5 text-xs">
        {/*
          ⚠️ « À LA {SEMAINE} » : ce chiffre cumule les heures posées JUSQU'À
          CETTE SEMAINE. Le taux global de l'établissement, lui, compte aussi les
          séances déjà posées sur les semaines à venir — les nommer pareil ferait
          chercher une erreur de calcul.
        */}
        <span className="text-muted-foreground">À la {courante?.libelle ?? 'semaine en cours'} : </span>
        <span className="font-medium tabular-nums">{nombre(atteint)} %</span>
        <span className="text-muted-foreground"> contre {nombre(regional.taux)} % attendus — </span>
        <span className={ecart >= 0 ? 'font-medium text-success' : 'font-medium text-destructive'}>
          {ecart >= 0 ? `+${nombre(ecart)}` : nombre(ecart)} point(s)
        </span>
      </p>

      <div className="mt-2">
        <GrapheProgression
          progression={progression}
          courante={courante}
          fenetre={FENETRE}
          hauteur={180}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-1 text-xs">
        <Repere couleur={COULEURS_PROGRESSION.avancement} libelle="Avancement" />
        <Repere couleur={COULEURS_PROGRESSION.regional} libelle="Rythme régional attendu" />
        {/* La fenêtre ne fait que trois semaines : la bande n'y apparaît que
            rarement, et la nommer quand elle n'est pas là ferait chercher. */}
        {fenetreEnVacances && <Repere couleur={COULEUR_VACANCES} libelle="Vacances" />}
      </div>
    </section>
  );
}

function Repere({ couleur, libelle }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="block size-3 rounded-sm" style={{ background: couleur }} />
      {libelle}
    </span>
  );
}
