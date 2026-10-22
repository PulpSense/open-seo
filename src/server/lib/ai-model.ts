import type { LanguageModelV3 } from "@openrouter/ai-sdk-provider";
import { defaultSettingsMiddleware, wrapLanguageModel } from "ai";
import { isHostedAuthMode } from "@/lib/auth-mode";
import { buildChatAgentModel } from "./openrouter";
import { getEnvValueSync, getOptionalEnvValue } from "./runtime-env";

const AI_ENV_NAMES = [
  "AUTH_MODE",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL",
] as const;

export function getAiModelConfig(env: object) {
  // Hosted billing requires OpenRouter's actual USD usage metadata. Direct
  // OpenAI is a bring-your-own-key option for self-hosted deployments.
  const openaiKey = getEnvValueSync(env, "OPENAI_API_KEY");
  if (!isHostedAuthMode(getEnvValueSync(env, "AUTH_MODE")) && openaiKey) {
    return {
      provider: "openai" as const,
      apiKey: openaiKey,
      model: getEnvValueSync(env, "OPENAI_MODEL") ?? "gpt-5.6-luna",
    };
  }
  const openrouterKey = getEnvValueSync(env, "OPENROUTER_API_KEY");
  return openrouterKey
    ? {
        provider: "openrouter" as const,
        apiKey: openrouterKey,
        model: getEnvValueSync(env, "OPENROUTER_MODEL"),
      }
    : null;
}

export function buildConfiguredAiModel(
  env: object,
  reasoningEffort: "max" | "low" = "max",
): LanguageModelV3 {
  const config = getAiModelConfig(env);
  if (!config) {
    throw new Error(
      "Configure OPENAI_API_KEY or OPENROUTER_API_KEY for AI features.",
    );
  }
  if (config.provider === "openrouter") {
    return buildChatAgentModel(config.apiKey, config.model, reasoningEffort);
  }
  // Think requires a synchronous model hook. Load the provider on inference,
  // keeping it out of the Worker's constrained eager startup graph.
  const load = async () => {
    const { createOpenAI } = await import("@ai-sdk/openai");
    return wrapLanguageModel({
      model: createOpenAI({ apiKey: config.apiKey }).responses(config.model),
      middleware: defaultSettingsMiddleware({
        settings: {
          providerOptions: {
            openai: { reasoningEffort, strictJsonSchema: false },
          },
        },
      }),
    });
  };
  return {
    specificationVersion: "v3",
    provider: "openai.responses",
    modelId: config.model,
    supportedUrls: {},
    doGenerate: async (params) => (await load()).doGenerate(params),
    doStream: async (params) => (await load()).doStream(params),
  };
}

export async function getConfiguredAiModel(
  reasoningEffort: "max" | "low" = "max",
) {
  const env = Object.fromEntries(
    await Promise.all(
      AI_ENV_NAMES.map(
        async (name) => [name, await getOptionalEnvValue(name)] as const,
      ),
    ),
  );
  return buildConfiguredAiModel(env, reasoningEffort);
}
