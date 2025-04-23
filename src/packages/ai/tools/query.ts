import { z } from 'zod';
import { tool } from 'ai';
import { redis } from '@/packages/redis/client';
import { pg } from '@/drizzle/client';


redis.setMaxListeners(20);

export const queryStore = tool({
  description: `
    OBRIGAÇÕES:
      - A QUANTIDADE DE HISTÓRICOS DEPENDE DO CONTEXTO DA MENSAGEM
      - TODOS OS CAMPOS DEVEM SER PREENCHIDOS E NUNCA DEVEM SER VAZIOS OU UNDEFINED
      - SE QUALQUER CAMPO FOR VAZIO OU UNDEFINED, UM ERRO SERÁ GERADO
  `,
  parameters: z.object({
    userId: z.string().nonempty().refine(val => val !== undefined, {
      message: "O CAMPO 'USERID' É OBRIGATÓRIO E NÃO PODE SER VAZIO OU UNDEFINED."
    }).describe('ID DO USUÁRIO (DEVE SER UM VALOR VÁLIDO E NUNCA VAZIO OU UNDEFINED)'),
    remoteJid: z.string().nonempty().refine(val => val !== undefined, {
      message: "O CAMPO 'REMOTEJID' É OBRIGATÓRIO E NÃO PODE SER VAZIO OU UNDEFINED."
    }).describe('IDENTIFICADOR DO DESTINATÁRIO (USUÁRIO) (DEVE SER UM VALOR VÁLIDO E NUNCA VAZIO OU UNDEFINED)'),
    limit: z.number()
      .min(1)
      .default(20)
      .nullable()
      .optional()
      .refine(val => val !== undefined, {
        message: "O CAMPO 'LIMIT' É OPCIONAL, MAS, SE FORNECIDO, NÃO PODE SER UNDEFINED."
      })
      .describe('LIMITE DEVE SER SEMPRE ALTERORIOS NUNCA 1 OU 0'),
  }),
  execute: async ({ userId, remoteJid, limit }) => {
    if (userId === undefined || remoteJid === undefined || limit === undefined) {
      throw new Error("TODOS OS PARÂMETROS (USERID, REMOTEJID E LIMIT) DEVEM SER FORNECIDOS E NÃO PODEM SER UNDEFINED.");
    }

    if (!userId || !remoteJid) {
      throw new Error("USERID E REMOTEJID NÃO PODEM SER VAZIOS OU NULOS.");
    }

    const LIMITE = limit ?? 20; 
    const redisClient = redis;
    const key = `wa:history:${userId}:${remoteJid}`;
    const raw = await redisClient.hvals(key);

    const msgs = raw
      .map((m) => JSON.parse(m) || m)
      .filter((msg) => msg.role !== 'assistent')
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, LIMITE);

    console.log("EXECUTE QUERY REDIS", msgs,{ userId, remoteJid, limit });

    return JSON.stringify(msgs, null, 2);
  }
});



export const query = tool({
  description: `
    TABLES appointments => DE COMPROMISOS
     ***
      CREATE TYPE "public"."status_enum" AS ENUM('pending', 'completed', 'in_progress');
      CREATE TABLE "appointments" (
        "id" uuid PRIMARY KEY ,
        "id_client" uuid NOT NULL ,
        "user_id" uuid NOT NULL,
        "datetime_start" timestamp ,
        "datetime_end" timestamp ,
        "status" "status_enum" NOT NULL,
        "value" numeric(10, 2) ,
        "name" varchar(255) ,
        "description" varchar(255) ,
        "quantity" integer ,
        "category" varchar(255) ,
        "price" numeric(10, 2) ,
        "details" varchar(255)
      );
    ***
  `,
  parameters: z.object({
      query: z.string()
        .nonempty(`- A QUERY NÃO PODE SER VAZIA. FORNEÇA UMA QUERY VÁLIDA.`)
        .describe(`- QUERY DO POSTGRES QUE SERÁ EXECUTADA.`),
      params: z.array(z.string()).describe(` - PARÂMETROS DA QUERY A SEREM EXECUTADOS.`), 
  }),
  execute: async ({ params, query } ) => {

      console.log({ params, query } );
 
      const result = await pg.unsafe(query, params);
 
      console.log(`✅ QUERY-SQL: ${query} -- PARAMS: ${params} \n RESULT: ${JSON.stringify(result)}`);
 
      return JSON.stringify(result);
    }
});















