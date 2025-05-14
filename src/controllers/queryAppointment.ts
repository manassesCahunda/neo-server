import { appointment, client } from "@/drizzle/schema";
import { user } from "@/drizzle/schema";
import { db } from "@/drizzle/client";
import { eq } from "drizzle-orm";

export type AppointmentMessage = {
  id: string;
  name: string;
  client_name: string;
  user_name: string;
  datetime_start: string;
  category: string;
  appointment_status: string;
  value: string;
  description: string;
  quantity: number;
  price: string;
  details: string;
};

export const select = async ({
  userId,
}: {
  userId: string;
}): Promise<AppointmentMessage[]> => {
  try {
    const rows = await db
      .select({
        id: appointment.id,
        name: appointment.name,
        client_name: client.username,
        user_name: user.name,
        datetime_start: appointment.datetime_end,
        category: appointment.category,
        appointment_status: appointment.appointment_status,
        value: appointment.value,
        description: appointment.description,
        quantity: appointment.quantity,
        price: appointment.price,
        details: appointment.details,
      })
      .from(appointment)
      .innerJoin(client, eq(appointment.id_client, client.id))
      .innerJoin(user, eq(appointment.userId, user.id))
      .where(eq(appointment.userId, userId));

    const formatted = rows.map((r) => {
      let status: string;
      switch (r.appointment_status) {
        case "in_progress":
          status = "confirmado";
          break;
        case "pending":
          status = "pendente";
          break;
        case "completed":
          status = "cancelado";
          break;
        default:
          status = r.appointment_status;
      }

      return {
        ...r,
        appointment_status: status,
        value: r.value.toString(),
        price: r.price.toString(),
      };
    });

    return formatted;
  } catch (error) {
    console.error("ERROR SELECTING APPOINTMENTS:", error);
    throw new Error("FAILED TO SELECT APPOINTMENTS");
  }
};
