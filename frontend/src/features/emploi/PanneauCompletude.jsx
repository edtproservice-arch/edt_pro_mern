import { Fragment } from 'react';
import { ClipboardCheck } from 'lucide-react';

import CadrePanneauDroit from '@/components/layout/CadrePanneauDroit';
import Alerte from '@/components/common/Alerte';
import { cn } from '@/lib/utils';

import { couleurCompletude } from './completudeApparence';
import ListeEcarts from './ListeEcarts';
import PlacementManquantes from './PlacementManquantes';

/**
 * La semaine affichée est-elle conforme au chronogramme ?
 * ← la fenêtre `completudeOverlay` de emploi.html + `api/data/get_completude.php`
 *
 * ═══ POURQUOI CETTE FENÊTRE EXISTE ═══
 * Le chronogramme fixe le VOLUME de chaque module par semaine ; la grille place
 * ces heures dans des créneaux. Rien ne garantissait que les deux disent la
 * même chose : une séance oubliée ou posée en trop passait inaperçue jusqu'au
 * calcul d'avancement, des semaines plus tard.
 *
 * ⚠️ ELLE PORTE SUR TOUS LES GROUPES DE L'ÉTABLISSEMENT, pas seulement ceux
 *    affichés — un groupe absent de la vue est justement celui qu'on oublie.
 *    C'est pourquoi le calcul est au serveur et non dans la page.
 *
 * ═══ ⚠️ UNE COLONNE À DROITE DE LA GRILLE, PLUS UNE FENÊTRE (2026-09-28,
 * demandes du porteur : « le fond accessible, comme une side bar », puis
 * « à droite, décale la grille ») ═══
 * Le rapport sert à CORRIGER la grille : placer, supprimer, déplacer, puis
 * relire le taux. Une fenêtre modale obligeait à la fermer pour chaque geste ;
 * un panneau superposé cachait la partie de la grille qu'on corrigeait.
 *
 * ═══ « COMME CELUI DE NOTION » (2026-09-28, capture du panneau IA de Notion) ═══
 * Une colonne de la FENÊTRE, pas une carte dans la page : pleine hauteur,
 * collée au bord droit, un simple trait vertical, ni arrondi ni ombre, et une
 * barre d'en-tête de 50 px alignée sur celle de l'application. Rendu dans
 * l'emplacement de la coquille (`PanneauDroit`) : toute la zone de page,
 * en-tête compris, se resserre à sa gauche. Seul le CONTENU défile. Son cadre
 * — en-tête sans trait, bord gauche qu'on glisse pour redimensionner ou qu'on
 * clique pour fermer — est `CadrePanneauDroit`, réutilisable.
 * Il se ferme aussi par sa croix ou par le bouton du taux — jamais par Échap,
 * qui désélectionne dans la grille.
 */
export default function PanneauCompletude({
  onFermer,
  bilan,
  libelle,
  peutPlacer = false,
  onAllerAuxCases,
}) {
  if (!bilan) return null;

  const { total, groupes = [], ecarts = [], inconnus = [] } = bilan;
  const couleur = couleurCompletude(total.taux);

  return (
    <CadrePanneauDroit
      titre="Conformité au chronogramme"
      icone={ClipboardCheck}
      onFermer={onFermer}
      cleLargeur="edtpro.panneau-conformite.largeur"
    >
        <p className="-mb-2 text-sm text-muted-foreground">
          {libelle} · {total.seancesGrille} séance(s) dans la grille
        </p>

        {/* ─── Le taux, en gros, avec sa barre ─────────────────────────── */}
        <div className="flex items-center gap-4">
          <div className={cn('text-4xl font-extrabold leading-none', couleur.texte)}>
            {total.taux === null ? '—' : `${total.taux} %`}
          </div>

          <div className="min-w-0 flex-1">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
              <div
                className={cn('h-full rounded-full transition-all', couleur.barre)}
                style={{ width: `${Math.min(100, total.taux ?? 0)}%` }}
              />
            </div>

            <p className="mt-1.5 text-sm">
              <strong>{total.pose} h</strong> posées sur <strong>{total.prevu} h</strong> prévues
              {total.manquant > 0 && (
                <span className="text-destructive"> · −{total.manquant} h manquantes</span>
              )}
              {total.enTrop > 0 && (
                <span className="text-warning"> · +{total.enTrop} h hors plan</span>
              )}
              {total.manquant === 0 && total.enTrop === 0 && total.prevu > 0 && (
                <span className="text-success"> · conforme</span>
              )}
            </p>

            {/*
              ⚠️ LE TAUX ET LA RÉALISATION RÉPONDENT À DEUX QUESTIONS.
              Le taux plafonne à 100 — au-delà du plan on s'en ÉLOIGNE ; la
              réalisation, elle, peut dépasser. Les confondre ferait lire un
              dépassement comme une réussite, ce que l'ancien faisait.
            */}
            <p className="mt-1 text-xs text-muted-foreground">
              Le manque <strong>et</strong> le dépassement font baisser ce taux.
              {total.realisation !== null && total.realisation !== total.taux && (
                <> Volume posé : {total.realisation} % du prévu.</>
              )}
            </p>
          </div>
        </div>

        {/* ─── Les écarts, ou le mot qui dit qu'il n'y en a pas ─────────── */}
        {ecarts.length === 0 ? (
          <Alerte type="succes" titre="Semaine conforme">
            Chaque module a exactement les heures que le chronogramme prévoit pour cette
            semaine.
          </Alerte>
        ) : (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {ecarts.length} écart(s)
            </p>

            {/*
              ⚠️ UNE CAUSE PROBABLE, PAS UN VERDICT. Une séance manquante l'est
              le plus souvent parce que la place manquait — espace occupé,
              groupe pris, formateur indisponible. Le dire évite de chercher une
              erreur de saisie là où il n'y en a pas ; l'affirmer serait faux,
              le générateur seul sait pourquoi il n'a pas placé.
            */}
            <p className="mb-3 text-xs text-muted-foreground">
              Causes fréquentes d’une séance à placer : espace déjà occupé, groupe pris,
              formateur indisponible.
            </p>

            <ListeEcarts ecarts={ecarts} onAllerAuxCases={onAllerAuxCases} />
          </div>
        )}

        {/*
          ─── Placer ce qui manque ─────────────────────────────────────────
          ⚠️ AU DIRECTEUR SEUL, comme Générer : le geste écrit la grille depuis
          le chronogramme. ⚠️ `key` sur la semaine : l'aperçu d'une semaine ne
          doit jamais survivre au passage à la suivante.
        */}
        {peutPlacer && (
          <PlacementManquantes
            key={bilan.semaine}
            semaine={bilan.semaine}
            numero={bilan.numero}
            aPlacer={ecarts.filter((e) => e.nature === 'manquante').length}
          />
        )}

        {/* ─── Les chronogrammes sans groupe ───────────────────────────── */}
        {inconnus.length > 0 && (
          /*
            ⚠️ NOMMÉS, JAMAIS COMPTÉS DANS LE TAUX. Le taire laisserait un
            chronogramme fantôme vivre indéfiniment ; le compter donnerait un
            manque que rien ne peut combler — le groupe n'a plus d'affectation.
            ⚠️ Et la correction est l'INVERSE de celle d'un écart : c'est le
            chronogramme qu'il faut retirer ou renommer, pas une séance à poser.
          */
          <Alerte type="avertissement" titre="Des chronogrammes portent sur des groupes absents de la carte">
            {inconnus.map((g, rang) => (
              <Fragment key={g.groupe}>
                {rang > 0 && ' · '}
                <strong>{g.groupe}</strong> ({g.prevu} h)
              </Fragment>
            ))}
            <span className="mt-1 block text-muted-foreground">
              Leurs heures ne seront jamais posées. C’est ce chronogramme qu’il faut retirer
              ou renommer — pas une séance à ajouter.
            </span>
          </Alerte>
        )}

        {/* ─── Le détail par groupe, replié dans un tableau compact ────── */}
        {groupes.length > 1 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Par groupe
            </p>
            {/* ⚠️ PLUS DE HAUTEUR MAXIMALE (2026-09-28, demande du porteur : « s'il y a
                l'espace, affiche tous les groupes sans scrollbar ») : la liste
                s'étale, et c'est le panneau (`CadrePanneauDroit`) qui défile — UNE
                seule barre, seulement quand l'écran manque de place. */}
            <ul className="divide-y rounded-lg border px-3">
              {groupes.map((g) => {
                const ton = couleurCompletude(g.taux);
                return (
                  <li key={g.groupe} className="flex items-center gap-3 py-1.5 text-sm">
                    <span className={cn('w-12 text-right font-semibold tabular-nums', ton.texte)}>
                      {g.taux === null ? '—' : `${g.taux}%`}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{g.groupe}</span>
                    <span className="text-xs text-muted-foreground">
                      {g.pose} / {g.prevu} h
                      {g.ecarts.length > 0 && ` · ${g.ecarts.length} écart(s)`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
    </CadrePanneauDroit>
  );
}
