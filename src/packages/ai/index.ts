import { env } from "@/env";
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';

export const openai = createOpenAI({
  apiKey: env.OPENAI_API_KEY
});

export const google  = createGoogleGenerativeAI({apiKey: env.GOOGLE_API_KEY_AI,});

