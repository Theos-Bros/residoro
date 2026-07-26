import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { registerHealthRoute } from './routes/health.js';
import { registerMigrationRoutes } from './routes/migrations.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerExportRoutes } from './routes/export.js';
import { registerListingsRoutes } from './routes/listings.js';
import { registerDocketRoutes } from './routes/dockets.js';
import { registerPropertyMediaRoutes } from './routes/propertyMedia.js';
import { registerPropertyDocumentsRoutes } from './routes/propertyDocuments.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart);
await registerHealthRoute(app);
await registerMigrationRoutes(app);
await registerAdminRoutes(app);
await registerWorkspaceRoutes(app);
await registerExportRoutes(app);
await registerListingsRoutes(app);
await registerDocketRoutes(app);
await registerPropertyMediaRoutes(app);
await registerPropertyDocumentsRoutes(app);

const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
