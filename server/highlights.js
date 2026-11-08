import { getCache } from '@vercel/functions';

// Short, plain-English highlights for a release email, written by the same models
// Hoora Assist uses. Only the real change titles are given to the model, and the result
// is cached per release version, so each release costs one small request.
const models = ['openai/gpt-5.4-nano', 'openai/gpt-5-mini'];
const MAX = 4;

const instructions = `You write the "What's new" highlights for an internal Hoora release email. Hoora is an Indian car care company (doorstep car wash, servicing, accessories, roadside help).
Rules:
- Choose the ${MAX} most important changes for customers or the business. Prefer one per area.
- When choosing, skip purely internal or technical changes: analytics, tracking events, data fields, naming, vendor or gateway setup.
- Write every highlight in the same pattern: a short noun phrase of 3 to 6 words, in sentence case, naming the outcome customers get. Examples: "Live activity for ongoing bookings", "Glass replacement on the home screen", "Smoother order tracking", "Automatic free roadside assistance", "Clearer e-store order status".
- Describe the outcome, never the task, bug or system: "Clearer order status", not "Order visibility issue"; "Faster checkout", not "Payment gateway integration". No vendor names (Cashfree, Razorpay, WebEngage) or abbreviations such as RSA, OEM, PMS, API.
- No verbs or filler such as now, added, enabled, improved, fixed, new, introduced.
- Never repeat a word across highlights (other than a, the, for, on, of) and never repeat the area name.
- Use only facts in the given titles. Never invent features, numbers or names.
- No ticket keys, no emojis, no ending full stop, no internal jargon such as API or PMS unless it is the whole point.
- Reply with JSON only: [{"area": "<area name exactly as given>", "text": "<highlight>"}]`;

function parse(content, areas) {
  try {
    const list = JSON.parse(
      String(content)
        .replace(/^```(?:json)?|```$/gm, '')
        .trim(),
    );
    if (!Array.isArray(list)) return null;
    const clean = list
      .filter((item) => item && typeof item.text === 'string' && areas.includes(item.area))
      .map((item) => ({
        area: item.area,
        text: item.text
          .replace(/\bRSA\b/g, 'roadside assistance')
          .replace(/\s+/g, ' ')
          .replace(/\.$/, '')
          .trim()
          .slice(0, 80),
      }))
      .filter((item) => item.text)
      .slice(0, MAX);
    return clean.length >= 2 ? clean : null;
  } catch {
    return null;
  }
}

/** sections: [{ name, items: [title] }]. Returns [{ area, text }] or null to use titles. */
export async function releaseHighlights(cacheKey, sections) {
  const token = process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN;
  if (!token || !sections.length) return null;
  const key = 'release-highlights:v2:' + cacheKey;
  let cache = null;
  try {
    cache = getCache();
    const saved = await cache.get(key);
    if (saved) return saved;
  } catch {}
  const areas = sections.map((section) => section.name);
  const titles = sections
    .map(
      (section) =>
        `${section.name}:\n${section.items
          .slice(0, 25)
          .map((item) => '- ' + item)
          .join('\n')}`,
    )
    .join('\n\n');
  for (const model of models) {
    try {
      const response = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: titles },
          ],
          // Choosing the right four changes needs some thought; it runs once per release.
          reasoning: { effort: 'medium' },
          max_tokens: 3000,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) continue;
      const result = await response.json();
      const highlights = parse(result.choices?.[0]?.message?.content, areas);
      if (!highlights) continue;
      try {
        await cache?.set(key, highlights, { ttl: 60 * 60 * 24 * 30 });
      } catch {}
      return highlights;
    } catch {
      // Try the next model; the email falls back to the change titles.
    }
  }
  return null;
}
