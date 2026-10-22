import { generateText, stepCountIs, tool } from "ai";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { buildConfiguredAiModel, getAiModelConfig } from "./ai-model";

beforeEach(() => {
  vi.unstubAllEnvs();
});

it("keeps hosted deployments on OpenRouter when both keys are present", () => {
  expect(
    getAiModelConfig({
      AUTH_MODE: "hosted",
      OPENAI_API_KEY: "direct-key",
      OPENROUTER_API_KEY: "router-key",
    })?.provider,
  ).toBe("openrouter");
});

it("requires the hosted billing provider even if a direct key exists", () => {
  expect(
    getAiModelConfig({ AUTH_MODE: "hosted", OPENAI_API_KEY: "direct-key" }),
  ).toBeNull();
});

function response(output: unknown[]) {
  return Response.json({
    id: "resp_test",
    object: "response",
    created_at: 0,
    model: "gpt-5.6-luna",
    status: "completed",
    output,
    usage: {
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 12,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  });
}

it("sends the self-hosted key to OpenAI and completes a tool round trip", async () => {
  const execute = vi.fn(async () => ({ clicks: 34 }));
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      response([
        {
          type: "function_call",
          id: "fc_test",
          call_id: "call_test",
          name: "site_metrics",
          arguments: '{"site":"vivacryo.com"}',
          status: "completed",
        },
      ]),
    )
    .mockResolvedValueOnce(
      response([
        {
          type: "message",
          id: "msg_test",
          role: "assistant",
          content: [
            { type: "output_text", text: "34 clicks", annotations: [] },
          ],
        },
      ]),
    );
  const result = await generateText({
    model: buildConfiguredAiModel(
      {
        AUTH_MODE: "cloudflare_access",
        OPENAI_API_KEY: "direct-key",
        OPENROUTER_API_KEY: "router-key",
      },
      "low",
    ),
    prompt: "Read the site's metrics.",
    tools: {
      site_metrics: tool({
        inputSchema: z.object({
          site: z.string(),
          startDate: z.string().optional(),
        }),
        execute,
      }),
    },
    stopWhen: stepCountIs(2),
  });
  expect(result.text).toBe("34 clicks");
  expect(execute).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls).toHaveLength(2);
  for (const [url, options] of fetchMock.mock.calls) {
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(new Headers(options?.headers).get("authorization")).toBe(
      "Bearer direct-key",
    );
    const body = z
      .object({
        tools: z.array(
          z.object({
            strict: z.boolean(),
            parameters: z.object({ required: z.array(z.string()) }),
          }),
        ),
      })
      .parse(
        JSON.parse(typeof options?.body === "string" ? options.body : "{}"),
      );
    expect(body.tools[0].strict).toBe(false);
    expect(body.tools[0].parameters.required).toEqual(["site"]);
  }
});
