import { FastifyPluginAsync } from "fastify";
import jwt, { JwtPayload } from "jsonwebtoken";
import { env } from "../env";

export const verifyAuth: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", async (request, reply) => {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader) {
        return reply.status(401).send({ error: "UNAUTHORIZED" });
      }

      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, env.JWT_SECRET) as JwtPayload;

      if (!decoded || !decoded.userId) {
        return reply.status(401).send({ error: "INVALID TOKEN" });
      }

      request.user = decoded as JwtPayload & { userId: string };
    } catch (error) {
      return reply.status(401).send({ error: "INVALID OR EXPIRED TOKEN" });
    }
  });

};
