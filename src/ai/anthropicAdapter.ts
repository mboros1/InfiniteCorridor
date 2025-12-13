/**
 * Anthropic Claude API adapter for AI flavor generation.
 *
 * Uses the official @anthropic-ai/sdk package.
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { AIAdapter, RoomFlavorRequest, RoomFlavorResponse } from './contracts.js';
import {
  buildRoomFlavorPrompt,
  buildRoomFlavorRepairPrompt,
  createFallbackResponse,
  parseRoomFlavorResponseText,
  shouldAttemptRoomFlavorRepair,
} from './utils.js';
import { consoleLogger, type Logger } from '../utils/logger.js';
import { E } from '../utils/fp.js';

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
      async function callClaude(prompt: string): Promise<string> {
        const message = await client.messages.create({
          model,
          max_tokens: 1500,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        });

        const textBlock = message.content.find((block) => block.type === 'text');
        if (!textBlock || textBlock.type !== 'text') {
          throw new Error('No text response from Claude');
        }

        return textBlock.text;
      }

      const userPrompt = buildRoomFlavorPrompt(request);
      const content = await callClaude(userPrompt);

      const parsedResponse = parseRoomFlavorResponseText(content, logger);
      if (E.isRight(parsedResponse)) return parsedResponse.right;

      if (shouldAttemptRoomFlavorRepair(parsedResponse.left)) {
        logger.warn('Claude response invalid; attempting one repair pass', {
          code: parsedResponse.left.code,
          message: parsedResponse.left.message,
        });

        try {
          const repairPrompt = buildRoomFlavorRepairPrompt({
            previousText: content,
            error: parsedResponse.left,
          });
          const repairedContent = await callClaude(repairPrompt);
          const repaired = parseRoomFlavorResponseText(repairedContent, logger);
          if (E.isRight(repaired)) return repaired.right;

          logger.error('Claude repair failed; falling back', {
            code: repaired.left.code,
            message: repaired.left.message,
            context: repaired.left.context,
          });
          return createFallbackResponse(request);
        } catch (cause) {
          logger.error('Claude repair request failed; falling back', { cause });
          return createFallbackResponse(request);
        }
      }

      logger.error('Claude response parse/validation failed; falling back', {
        code: parsedResponse.left.code,
        message: parsedResponse.left.message,
        context: parsedResponse.left.context,
      });
      return createFallbackResponse(request);
    },
  };
}

// Re-export mock adapter for testing
export { createMockAdapter } from './openRouterAdapter.js';
