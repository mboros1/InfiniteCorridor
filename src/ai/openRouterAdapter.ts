import { OpenRouter } from '@openrouter/sdk';
import type { AIAdapter, RoomFlavorRequest, RoomFlavorResponse } from './contracts.js';
import { buildRoomFlavorPrompt, createFallbackResponse, parseRoomFlavorResponseText } from './utils.js';
import { consoleLogger, type Logger } from '../utils/logger.js';

export interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  siteUrl?: string;
  siteName?: string;
  logger?: Logger;
}

export function createOpenRouterAdapter(config: OpenRouterConfig): AIAdapter {
  const logger = config.logger ?? consoleLogger;
  const client = new OpenRouter({
    apiKey: config.apiKey,
  });

  // Default to a free model - can override via OPENROUTER_MODEL env var
  // Free models: meta-llama/llama-3.2-3b-instruct:free, nousresearch/hermes-3-llama-3.1-405b:free
  const model = config.model ?? 'nousresearch/hermes-3-llama-3.1-405b:free';

  return {
    async generateRoomFlavor(request: RoomFlavorRequest): Promise<RoomFlavorResponse> {
      const prompt = buildRoomFlavorPrompt(request);

      const completion = await client.chat.send({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        stream: false,
        maxTokens: 1500,
      });

      const rawContent = completion.choices?.[0]?.message?.content;
      if (!rawContent) {
        throw new Error('No response from AI');
      }

      // Handle array content (multi-part responses)
      const content = typeof rawContent === 'string'
        ? rawContent
        : rawContent.map((part) => ('text' in part ? part.text : '')).join('');

      const parsedResponse = parseRoomFlavorResponseText(content, logger);
      if (!parsedResponse.ok) {
        logger.error('AI response parse/validation failed:', {
          code: parsedResponse.error.code,
          message: parsedResponse.error.message,
          context: parsedResponse.error.context,
        });
        return createFallbackResponse(request);
      }

      return parsedResponse.value;
    },
  };
}

// Mock adapter for testing without API calls
export function createMockAdapter(): AIAdapter {
  return {
    async generateRoomFlavor(request: RoomFlavorRequest): Promise<RoomFlavorResponse> {
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 100));
      return createFallbackResponse(request);
    },
  };
}
