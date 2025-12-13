import { OpenRouter } from '@openrouter/sdk';
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
      async function callOpenRouter(prompt: string): Promise<string> {
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

        return typeof rawContent === 'string'
          ? rawContent
          : rawContent.map((part) => ('text' in part ? part.text : '')).join('');
      }

      const prompt = buildRoomFlavorPrompt(request);
      const content = await callOpenRouter(prompt);

      const parsedResponse = parseRoomFlavorResponseText(content, logger);
      if (E.isRight(parsedResponse)) return parsedResponse.right;

      if (shouldAttemptRoomFlavorRepair(parsedResponse.left)) {
        logger.warn('OpenRouter response invalid; attempting one repair pass', {
          code: parsedResponse.left.code,
          message: parsedResponse.left.message,
        });

        try {
          const repairPrompt = buildRoomFlavorRepairPrompt({
            previousText: content,
            error: parsedResponse.left,
          });
          const repairedContent = await callOpenRouter(repairPrompt);
          const repaired = parseRoomFlavorResponseText(repairedContent, logger);
          if (E.isRight(repaired)) return repaired.right;

          logger.error('OpenRouter repair failed; falling back', {
            code: repaired.left.code,
            message: repaired.left.message,
            context: repaired.left.context,
          });
          return createFallbackResponse(request);
        } catch (cause) {
          logger.error('OpenRouter repair request failed; falling back', { cause });
          return createFallbackResponse(request);
        }
      }

      logger.error('AI response parse/validation failed; falling back', {
        code: parsedResponse.left.code,
        message: parsedResponse.left.message,
        context: parsedResponse.left.context,
      });
      return createFallbackResponse(request);
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
