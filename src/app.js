import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';

import { env } from './config/env.js';
import routes from './routes/index.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

const UPLOADS_DIR = path.join(fileURLToPath(new URL('../uploads', import.meta.url)));

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: [env.clientWebOrigin, env.clientAdminOrigin],
      credentials: true,
    })
  );

  // Static hosting for admin-uploaded product images. Served off the app root
  // (not under the API prefix) so stored URLs are stable. CORP is relaxed to
  // cross-origin so the customer site / admin panel can <img src> them.
  app.use(
    '/uploads',
    express.static(UPLOADS_DIR, {
      maxAge: '30d',
      setHeaders: (res) => res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
    })
  );

  app.use(express.json());
  app.use(cookieParser());
  app.use(morgan(env.isProduction ? 'combined' : 'dev'));

  app.use(env.apiPrefix, routes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
