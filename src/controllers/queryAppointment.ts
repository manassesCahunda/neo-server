import { appointment } from "@/drizzle/schema";
import { db } from "@/drizzle/client";
import { eq } from "drizzle-orm";

export const select = async ({ userId }: { userId: string }) => {
  try {
    const response = await db.select(appointment).from(appointment).where(eq(appointment.userId, userId));
    return response;
  } catch (error) {
    console.error("ERROR SELECTING APPOINTMENT:", error);
    throw new Error("FAILED TO SELECT USER");
  }
};

