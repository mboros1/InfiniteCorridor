/**
 * Anthropic Claude API adapter for AI flavor generation.
 *
 * Uses the official @anthropic-ai/sdk package.
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AIAdapter, RoomFlavorRequest, RoomFlavorResponse } from './contracts.js';
import { buildRoomFlavorPrompt, createFallbackResponse, parseRoomFlavorResponseText } from './utils.js';
import { consoleLogger, type Logger } from '../utils/logger.js';

export interface AnthropicConfig {
  apiKey: string;
  model?: string;
  logger?: Logger;
}

export function createAnthropicAdapter(config: AnthropicConfig): AIAdapter {
  const logger = config.logger ?? consoleLogger;
  const client = new Anthropic({
    apiKey: config.apiKey,
  });

  // Default to Haiku for speed and cost efficiency
  // Options: claude-3-5-haiku-20241022, claude-sonnet-4-20250514, claude-opus-4-20250514
  const model = config.model ?? 'claude-haiku-4-5-20251001';


  return {
    async generateRoomFlavor(request: RoomFlavorRequest): Promise<RoomFlavorResponse> {
      const userPrompt = buildRoomFlavorPrompt(request);

      const message = await client.messages.create({
        model,
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      });

      // Extract text content from response
      const textBlock = message.content.find((block) => block.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text response from Claude');
      }

      const content = textBlock.text;

      const parsedResponse = parseRoomFlavorResponseText(content, logger);
      if (!parsedResponse.ok) {
        logger.error('Claude response parse/validation failed:', {
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

// Re-export mock adapter for testing
export { createMockAdapter } from './openRouterAdapter.js';
