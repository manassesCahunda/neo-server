import { env } from '../env';
import { fastify } from 'fastify';
import { fastifyCors } from '@fastify/cors';
import { fastifySwagger } from '@fastify/swagger';
import { fastifySwaggerUi } from '@fastify/swagger-ui';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { authRoutes, appointmentRoutes } from '@/routes';
import fastifyOauth2 from '@fastify/oauth2';
import fastifyCookie from '@fastify/cookie';
import { verifyAuth } from '@/routes/middlewares';
import { generateMessage } from '@/trigger/generate';
import { redis } from '@/packages/redis/client';
import WebSocket from 'ws';

const redisClient = redis;

type ServerMessage =
  | { type: 'qr'; data: string }
  | { type: 'connection'; data: boolean }
  | { type: 'error'; data: string }
  | { type: 'messages'; data: string };

(async () => {
  try {
    const app = fastify({ logger: true });

    app.setSerializerCompiler(serializerCompiler);
    app.setValidatorCompiler(validatorCompiler);

    app.register(fastifyCors);
    app.register(fastifyCookie);

    app.register(fastifyOauth2, {
      name: 'googleOAuth',
      scope: ['profile', 'email'],
      credentials: {
        client: { id: env.CLIENT_ID, secret: env.CLIENT_SECRET },
        auth: fastifyOauth2.GOOGLE_CONFIGURATION,
      },
      startRedirectPath: '/auth/google',
      callbackUri: `${env.API_URL}/auth/google/callback`,
    });

    app.register(fastifySwagger, {
      openapi: { info: { title: 'Nexo', version: '0.1' } },
      transform: jsonSchemaTransform,
    });

    app.register(fastifySwaggerUi, { routePrefix: '/docs' });

    app.register(authRoutes);

    app.register(async (protectedRoutes) => {
      protectedRoutes.register(verifyAuth);
      protectedRoutes.register(appointmentRoutes);
    });

    await app.ready();

    const sessions = (await redis.keys('authState:wa:session:*')).map((k) =>k.replace('authState:wa:session:', ''));

    app.log.info(`SESSIONS FOUND: ${sessions.join(', ')}`);
    async function connectWebSocket(session: string) {
      const wsClient = new WebSocket(`ws:localhost:${process.env.SOCKET_PORT}/?session=${session}`);
      
       wsClient.on('message', async (raw) => {
         const messages: any = JSON.parse(raw.toString());
         if (messages?.type === "messages") {
            const send = await generateMessage.trigger(messages?.data);
            if (!send) console.error('\n ERROR SENDING MESSAGE:', send);
            console.log('MESSAGE SENT:', send);
         }
       });
    
      wsClient.on('close', () => {
        console.log('[CLIENT] CONNECTION CLOSED');
        setTimeout(() => connectWebSocket(session), 5000);
      });
    
      wsClient.on('error', (err) => {
        console.error('[CLIENT] CONNECTION ERROR:', err);
        setTimeout(() => connectWebSocket(session), 5000);
      });
    }

    for (const session of sessions) {
      connectWebSocket(session);
    }
    
    await app.listen({ port: env.PORT });
    app.log.info(` HTTP SERVER RUNNING ON PORT ${env.PORT}`);
  } catch (err) {
    console.error('\n ERROR STARTING SERVER:', err);
    process.exit(1);
  }
})();
