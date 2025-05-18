import "@/types/fastify.d.ts";
import { z } from "zod";
import { eq } from "drizzle-orm";
import jwt, { JwtPayload } from "jsonwebtoken";
import { user } from "@/drizzle/schema";
import { db } from "@/drizzle/client";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { userSchema } from "@/types/type";
import { update , select } from "@/controllers/user";

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/auth/google/callback", {
    schema: {
      summary: "OAUTH 2.0 WITH GOOGLE PERSISTENCE DATABASE",
      operationId: "GET_AUTH",
      tags: ["GOOGLE"],
      response: {
        200: z.object({
          message: z.string(),
          user: z.object({
            sub: z.string(),
            email: z.string(),
            name: z.string(),
            picture: z.string(),
          }),
          userId: z.string(),
          token: z.string(),
        }),
      },
    },
  }, async (request, reply) => {
    try {
      const { token } = await app.googleOAuth.getAccessTokenFromAuthorizationCodeFlow(request);

      if (!token.id_token) {
        return reply.status(400).send({ error: "ID TOKEN NOT FOUND" });
      }

      const decoded = jwt.decode(token.id_token) as JwtPayload | null;
      if (!decoded || !decoded.sub || !decoded.email || !decoded.name || !decoded.picture) {
        return reply.status(400).send({ error: "INVALID OR MALFORMED TOKEN" });
      }

      const userInfo = {
        sub: decoded.sub,
        email: decoded.email,
        name: decoded.name,
        picture: decoded.picture,
      };

      const existingUser = await db
        .select()
        .from(user)
        .where(eq(user.googleId, userInfo.sub))
        .execute();

      const lastLogin = new Date();
      let userData: any;

      if (existingUser.length > 0) {
        const userUpdate = await db
          .update(user)
          .set({
            accessToken: token.access_token,
            refreshToken: token.refresh_token ?? null,
            name: userInfo.name,
            email: userInfo.email,
            avatar: userInfo.picture,
            type: "ENTERPRISE",
            lastLogin,
          })
          .where(eq(user.googleId, userInfo.sub))
          .returning({ id: user.id, avatar: user.avatar, name: user.name, email: user.email, type: user.type, prompt: user.prompt })
          .execute();

        userData = {
          id: userUpdate[0].id,
          avatar: userUpdate[0].avatar || "",
          type: userUpdate[0].type || "",
          email: userUpdate[0].email || "",
          name: userUpdate[0].name || "",
          prompt: userUpdate[0].prompt || "",
        };
      } else {
        const insertedUser = await db
          .insert(user)
          .values({
            name: userInfo.name,
            email: userInfo.email,
            googleId: userInfo.sub,
            accessToken: token.access_token,
            refreshToken: token.refresh_token ?? null,
            avatar: userInfo.picture,
            type: "ENTERPRISE",
            lastLogin,
          })
          .returning({ id: user.id, avatar: user.avatar, name: user.name, email: user.email, type: user.type, prompt: user.prompt })
          .execute();

        userData = {
          id: userUpdate[0].id,
          avatar: userUpdate[0].avatar || "",
          email: userUpdate[0].email || "",
          name: userUpdate[0].name || "",
        };
        
      }

      if (!process.env.JWT_SECRET) {
        return reply
          .status(500)
          .send({ error: "JWT SECRET NOT SET IN ENVIRONMENT VARIABLES" });
      }
        
        const appToken = jwt.sign(
          { userId: userData?.id },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );


      return reply.redirect(`${process.env.WEB_URL}/api/auth/callback?token=${appToken}`);

    } catch (error) {
      return reply.status(500).send({
        error: "GOOGLE AUTHENTICATION ERROR",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.get("/auth/logout", {
    schema: {
      summary: "LOGOUT OAUTH 2.0 WITH GOOGLE PERSISTENCE DATABASE",
      operationId: "DELETE_AUTH",
      tags: ["GOOGLE"],
      response: {
        200: z.object({ message: z.string() }),
      },
    },
  }, async (_request, reply) => {
    return reply.send({ message: "LOGOUT SUCCESSFUL (NO SESSION STORED)" });
  });

  app.put("/user", {
    schema: {
      summary: "UPDATE USER",
      operationId: "PUT_USER",
      body: z.object({
        userSchema,
        userId: z.string(),
      }),
      tags: ["UPDATE"],
      response: {
        200: z.object({ message: z.string(), data: z.object({}) }),
      },
    },
  }, async (request, reply) => {
    const { userId, userSchema } = request.body;
    const user = await update({ userId, clientData: userSchema });
    return reply.send({ message: "USER UPDATE SUCCESSFUL", data: user[0] });
  });
  app.get("/user/:userId", {
    schema: {
      summary: "SELECT USER",
      operationId: "SELECT",
      params: z.object({
        userId: z.string(),
      }),
      tags: ["SELECT"],
      response: {
        200: z.object({
          message: z.string(),
          data: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string(),
            avatar: z.string(),
            type: z.string(),
            prompt: z.string(),
            remoteJid: z.string(),
          }),
        }),
      },
    },
  }, async (request, reply) => {
    const { userId } = request.params; 
    try {
      const user = await select({ userId });
   
      const userData = {
        id: user[0].id || "",
        name: user[0].name || "",
        email: user[0].email || "",
        avatar: user[0].avatar || "",
        type: user[0].type || "",
        prompt: user[0].prompt || "",
        remoteJid:user[0].remoteJid || "",
      };
      
      
      return reply.send({
        message: "USER SELECT SUCCESSFUL",
        data: userData
      });
    } catch (error) {
      return reply.status(500).send({ message: "Error selecting user", error: error.message });
    }
  });
};
