import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const system = `You convert a director's spoken or typed note into ONE structured task for their executive assistant. Today's date is ${today}. Respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly this shape: {"title": string (max 8 words), "description": string (1-2 sentences, rephrase clearly), "priority": "low"|"medium"|"high", "dueDate": "YYYY-MM-DD" or null}. Infer priority and due date from context/wording if possible, otherwise use "medium" and null.`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: text }],
      }),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return NextResponse.json({ error: data?.error?.message || 'AI request failed' }, { status: 500 });
    }

    const raw = (data.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');

    const clean = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json(parsed);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Unknown error' }, { status: 500 });
  }
}
