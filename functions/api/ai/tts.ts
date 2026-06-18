type Env = {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
};

const getTtsUrl = (env: Env) => {
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  return `${baseUrl}/audio/speech`;
};

export async function onRequestPost(context: { request: Request; env: Env }) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const apiKey = String(env.OPENAI_API_KEY ?? "").trim();
  const text = String((body as Record<string, unknown>).text ?? (body as Record<string, unknown>).word ?? "").trim().slice(0, 1000);

  if (!apiKey) {
    return new Response("Missing OpenAI API key secret", { status: 503 });
  }
  if (!text) {
    return new Response("Missing text parameter", { status: 400 });
  }

  try {
    const response = await fetch(getTtsUrl(env), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "fable",
        input: text,
        response_format: "mp3",
      }),
    });

    if (!response.ok) {
      return new Response("TTS request failed", { status: 502 });
    }

    const audioData = await response.arrayBuffer();
    return new Response(audioData, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("TTS unavailable", { status: 502 });
  }
}
