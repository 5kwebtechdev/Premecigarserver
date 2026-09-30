import { Router } from 'express';

// Placeholder router for modules not yet implemented — keeps the full API
// surface from docs/backend-architecture.md mountable today so routes/index.js
// doesn't need to change again as each module gets built out.
export function stubRouter(moduleName) {
  const router = Router();
  router.all('*', (req, res) => {
    res.status(501).json({ message: `${moduleName} module is not implemented yet` });
  });
  return router;
}
