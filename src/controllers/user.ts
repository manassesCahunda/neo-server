import { user } from "@/drizzle/schema";
import { db } from "@/drizzle/client";
import { eq } from "drizzle-orm";
import { userSchema , userUpdateType } from "@/types/type"

export const update = async ({ userId, clientData }: userUpdateType) => {
  try {
    const validatedClient = userSchema.parse(clientData);

    const response = await db.update(user).set(validatedClient).where(eq(user.id, userId)).returning({id: user.id, avatar: user.avatar, name: user.name, email: user.email, type: user.type, prompt: user.prompt,remoteJid:user.remoteJid});

    return response;
  } catch (error) {
    console.error("ERROR UPDATING CLIENT:", error);
    throw new Error("FAILED TO UPDATE CLIENT");
  }
};

export const select = async ({ userId }: { userId: string }) => {
  try {
    const response = await db.select(user)
      .from(user)
      .where(eq(user.id, userId));

    return response;
  } catch (error) {
    console.error("ERROR SELECTING USER:", error);
    throw new Error("FAILED TO SELECT USER");
  }
};
