import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerHealthRoute } from './routes/health.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await registerHealthRoute(app);

const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: '0.0.0.0' }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
