// THE AGENT LOOP.
// Muse Spark decides which tool to call next; this file runs the tool,
// sends the result back, and repeats until the model gives a final answer.
import { TOOLS, runTool } from './tools.js';

const SYSTEM_PROMPT = `You are pixelPerfect, a senior frontend engineer working inside the developer's browser.
The developer has selected one or more elements on their running web app (numbered by index) and describes what is wrong or what should change.

First, understand the INTENT:
- A fix to one element ("center this", "wrong padding") → work on that element with preview_css.
- A change to a whole block, several elements, or a redesign ("make this section look like a card", "revamp this") → call get_structure on the selected container first, then change it with preview_stylesheet using the real selectors you saw. Do not reduce a block-level request to a fix of one child element.
- If the request is ambiguous, state your interpretation in one sentence at the start of your final answer.

How to work:
1. Always inspect first (inspect_element or get_structure), then find the cause (get_matched_rules, get_component). Never guess values you can measure.
2. Find WHY the style has its current value: which rule, which file, and why it wins (specificity, source order, inline style, media query).
3. Before changing anything, call verify with checks that describe the request (e.g. centered, css, spacing). It should FAIL, confirming the problem. If it already passes, say so and stop.
4. Propose the smallest change that meets the intent and try it with preview_css or preview_stylesheet.
5. Call verify again with the SAME checks. If any check fails, undo_preview, think about why, and try a different fix. At most 3 attempts.
   Checks must describe the developer's INTENT (e.g. "the block is visible as one bordered box": visible, css border on the container), not just restate the values you set.
   LEAVE THE FINAL, VERIFIED PREVIEW APPLIED. Only undo failed attempts. The developer reviews the result in the page.
6. When verify passes, call verify_responsive with the same checks to make sure the fix works on mobile, tablet and desktop. If a width fails, adjust the fix (for example with a media query) and verify again.
7. Read verify's warnings: if nearby elements moved, explain whether that is expected.
8. Only suggest changes that verify proves are needed. Never claim success without a passing verify.
9. Finish with a short answer in this format:
   CAUSE: one or two sentences naming the rule and file.
   FIX: the exact change to make in the source (file, selector, property: value). For stylesheet previews, give the full CSS.
   VERIFIED: the verify lines (✓/✗ with numbers), including responsive results.
Keep tool calls focused. Do not invent files or selectors that you have not seen in tool results.`;

export async function runAgent({ goal, element, tabId, settings, onStep, maxSteps = 16 }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Selected elements (by index): ${JSON.stringify(element)}\n\nRequest: ${goal}` }
  ];

  for (let step = 1; step <= maxSteps; step++) {
    onStep({ kind: 'thinking', step });
    const reply = await callMuseSpark(messages, settings);

    if (!reply.tool_calls?.length) {
      onStep({ kind: 'final', text: reply.content || '(no answer)' });
      return reply.content;
    }

    messages.push(reply);
    for (const call of reply.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      onStep({ kind: 'tool', name: call.function.name, args });

      const result = await runTool(tabId, call.function.name, args);
      onStep({ kind: 'result', name: call.function.name, result });

      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  const msg = `Stopped after ${maxSteps} steps without finishing. Handing back to you.`;
  onStep({ kind: 'final', text: msg });
  return msg;
}

// One call to Muse Spark through the Meta Model API (chat completions with tools).
export async function callMuseSpark(messages, { apiKey, model, baseUrl }, withTools = true) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      ...(withTools ? { tools: TOOLS, tool_choice: 'auto' } : {})
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error(`Unexpected API response: ${JSON.stringify(data).slice(0, 300)}`);
  return msg;
}
