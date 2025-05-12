import "@/types/fastify.d.ts";
import { z } from "zod";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { select } from "@/controllers/queryAppointment";

export const appointmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/appointment/:userId", {
    schema: {
      summary: "APPOINTMENT",
      operationId: "APPOINTMENT",
      params: z.object({
        userId: z.string(),
      }),
      tags: ["APPOINTMENT"],
      response: {
        200: z.object({
          message: z.string(),
          data:z.array(z.any())
        }),
      },
    },
  }, async (request, reply) => {
    try {
      const { userId } = request.params;
      const response = await select({ userId });

      if (response.length === 0)  return reply.status(404).send({ message: "User not found" , data:[] });

      return reply.send({
        message: "USER SELECT SUCCESSFUL",
        data: response,
      });
    } catch (error) {
      return reply.status(500).send({ message: "Internal server error", error: error.message });
    }
  });
};
