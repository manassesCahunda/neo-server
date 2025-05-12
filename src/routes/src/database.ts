import { z } from "zod";
import jwt from "jsonwebtoken";
import { DatabaseSchema } from "@/types/type";
import { create, update, select } from "@/controllers/database";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

type JwtPayload = { userId: string };

export const databaseRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/database",
    {
      schema: {
        summary: "SELECT DATABASE",
        operationId: "GET_DATABASE",
        tags: ["DATABASE"],
        response: {
          200: z.object({
            message: z.string(),
            data: z.array(z.any()).optional(),
          }),
        },
      },
    },
    async (request, reply) => {
      try {
        const authHeader = request.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          return reply.status(401).send({ message: "TOKEN NOT PROVIDED." });
        }

        const token = authHeader.split(" ")[1];
        if (!process.env.JWT_SECRET) {
          return reply.status(500).send({ message: "JWT SECRET NOT CONFIGURED." });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET) as JwtPayload;
        const data = await select({ userId: decoded.userId });

        return reply.send({ message: "SELECT DATABASE", data });
      } catch (error) {
        return reply.status(401).send({ message: "INVALID TOKEN." });
      }
    }
  );

  app.post(
    "/database",
    {
      schema: {
        summary: "CREATE DATABASE",
        operationId: "POST_DATABASE",
        body: DatabaseSchema,
        tags: ["DATABASE"],
        response: {
          200: z.object({
            message: z.string(),
            data: z.any().optional(),
          }),
        },
      },
    },
    async (request, reply) => {
      try {
        const data = request.body;
        const response = await create(data);

        return reply.send({ message: "DATABASE CREATED!", data: response || null });
      } catch (error) {
        return reply.status(500).send({ message: "DATABASE CREATION FAILED." });
      }
    }
  );

  app.put(
    "/database",
    {
      schema: {
        summary: "UPDATE DATABASE",
        operationId: "PUT_DATABASE",
        body: DatabaseSchema,
        tags: ["DATABASE"],
        response: {
          200: z.object({
            message: z.string(),
            data: z.any().optional(),
          }),
        },
      },
    },
    async (request, reply) => {
      try {
        const data = request.body;
        const response = await update({ userId: data.userId, clientData: data });

        return reply.send({ message: "DATABASE UPDATED!", data: response || null });
      } catch (error) {
        return reply.status(500).send({ message: "DATABASE UPDATE FAILED." });
      }
    }
  );
};