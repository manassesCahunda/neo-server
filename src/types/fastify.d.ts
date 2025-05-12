import "@fastify/oauth2";
import { FastifyRequest } from 'fastify';
import '@fastify/session';

declare module "fastify" {
  interface FastifyInstance {
    googleOAuth: import("@fastify/oauth2").OAuth2Namespace;
  }
}


declare module 'fastify' {
  interface FastifyRequest {
    session: any;
  }
}
