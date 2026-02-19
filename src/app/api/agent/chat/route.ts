import { prisma } from '@/lib/prisma';
import { streamChat } from '@/lib/agent';
import { convertToModelMessages } from 'ai';
import type { UIMessage } from 'ai';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const modelMessages = await convertToModelMessages(messages);
  const result = await streamChat(prisma, modelMessages);

  return result.toUIMessageStreamResponse();
}
