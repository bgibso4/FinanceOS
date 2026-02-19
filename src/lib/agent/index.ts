import { streamText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import type { PrismaClient } from '@prisma/client';
import type { ModelMessage } from 'ai';
import { buildSystemPrompt } from './system-prompt';
import { createAgentTools, executeGetCategories } from './tools';

export async function streamChat(prisma: PrismaClient, messages: ModelMessage[]) {
  // Fetch category tree for system prompt
  const categories = await executeGetCategories(prisma);
  const systemPrompt = buildSystemPrompt(categories);

  const tools = createAgentTools(prisma);

  const result = streamText({
    model: anthropic('claude-sonnet-4-20250514'),
    system: systemPrompt,
    messages,
    tools,
    stopWhen: stepCountIs(10),
  });

  return result;
}
