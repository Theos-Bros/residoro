import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { registerHealthRoute } from './routes/health.js';
import { registerMigrationRoutes } from './routes/migrations.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerWorkspaceRoutes } from './routes/workspace.js';
import { registerMembersRoutes } from './routes/members.js';
import { registerExportRoutes } from './routes/export.js';
import { registerListingsRoutes } from './routes/listings.js';
import { registerDocketRoutes } from './routes/dockets.js';
import { registerPropertyMediaRoutes } from './routes/propertyMedia.js';
import { registerPropertyDocumentsRoutes } from './routes/propertyDocuments.js';
import { registerProjectsRoutes } from './routes/projects.js';
import { registerContactsRoutes } from './routes/contacts.js';
import { registerShareTextRoutes } from './routes/shareText.js';
import { registerAnalyticsRoutes } from './routes/analytics.js';
import { registerSettingsPermissionsRoutes } from './routes/settingsPermissions.js';
import { registerInquiriesRoutes } from './routes/inquiries.js';
import { registerBuyerRequirementsRoutes } from './routes/buyerRequirements.js';
import { registerMatchingRoutes } from './routes/matching.js';
import { registerBuyerBroadcastRoutes } from './routes/buyerBroadcast.js';
import { registerTasksRoutes } from './routes/tasks.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(multipart);
await registerHealthRoute(app);
await registerMigrationRoutes(app);
await registerAdminRoutes(app);
await registerWorkspaceRoutes(app);
await registerMembersRoutes(app);
await registerExportRoutes(app);
await registerListingsRoutes(app);
await registerDocketRoutes(app);
await registerPropertyMediaRoutes(app);
await registerPropertyDocumentsRoutes(app);
await registerProjectsRoutes(app);
await registerContactsRoutes(app);
await registerShareTextRoutes(app);
await registerAnalyticsRoutes(app);
await registerSettingsPermissionsRoutes(app);
await registerInquiriesRoutes(app);
await registerBuyerRequirementsRoutes(app);
await registerMatchingRoutes(app);
await registerBuyerBroadcastRoutes(app);
await registerTasksRoutes(app);

const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
