import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { message, role, history, audioBase64, audioMimeType } = await req.json();
    if ((!message || typeof message !== 'string') && !audioBase64) {
      return NextResponse.json({ error: 'Missing message or audio' }, { status: 400 });
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not set. Add it in Vercel Project Settings > Environment Variables, then redeploy.' }, { status: 500 });
    }

    const system = `You are a helpful AI assistant embedded in a director/executive-assistant productivity dashboard called "The Desk". The current user is the ${role === 'director' ? 'Managing Director' : 'Executive Assistant'}. Be concise, practical and warm. If the user's turn is a voice note, listen to it directly and respond naturally to what they said.`;

    const historyContents = ((history || []) as { role: string; text: string }[]).map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }],
    }));

    const finalUserParts: any[] = [];
    if (audioBase64) {
      finalUserParts.push({ inline_data: { mime_type: audioMimeType || 'audio/webm', data: audioBase64 } });
    } else {
      finalUserParts.push({ text: message });
    }

    const contents = [...historyContents, { role: 'user', parts: finalUserParts }];

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents,
        }),
      }
    );

    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json({ error: data?.error?.message || 'AI request failed' }, { status: 500 });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('\n') || 'Sorry, no reply.';

    return NextResponse.json({ reply });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
