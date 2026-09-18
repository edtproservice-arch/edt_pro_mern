/**
 * Validation Zod des entrées HTTP.
 *
 * Garde-fou n°1 du §5bis du plan : sans TypeScript, c'est la validation runtime
 * qui tient lieu de contrat. Toute route qui lit `req.body`, `req.query` ou
 * `req.params` doit d'abord passer par ici.
 *
 *   router.post('/', validate({ body: creerSeanceSchema }), controleur)
 *
 * Après validation, `req.body` contient la valeur PARSÉE (types coercés,
 * valeurs par défaut appliquées, champs inconnus retirés).
 */
export function validate(schemas) {
  return (req, res, next) => {
    try {
      if (schemas.body) req.body = schemas.body.parse(req.body);
      if (schemas.query) req.validatedQuery = schemas.query.parse(req.query);
      if (schemas.params) req.params = schemas.params.parse(req.params);
      next();
    } catch (error) {
      next(error); // ZodError → 400 dans errorHandler
    }
  };
}
