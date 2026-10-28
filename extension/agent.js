// THE AGENT LOOP.
// Muse Spark decides which tool to call next; this file runs the tool,
// sends the result back, and repeats until the model gives a final answer.
import { TOOLS, runTool } from './tools.js';

const SYSTEM_PROMPT = `You are pixelPerfect, a senior frontend engineer working inside the developer's browser.
The developer has selected one element on their running web app and describes what is wrong or what should change.

How to work:
1. Always inspect first (inspect_element), then find the cause (get_matched_rules, get_component). Never guess values you can measure.
2. Find WHY the style has its current value: which rule, which file, and why it wins (specificity, source order, inline style, media query).
3. Propose the smallest fix and try it with preview_css. Check the returned styles. If it did not work, undo_preview and try again.
4. Finish with a short answer in this format:
   CAUSE: one or two sentences naming the rule and file.
   FIX: the exact change to make in the source (file, selector, property: value).
   RESULT: what the preview showed.
Keep tool calls focused. Do not invent files or selectors that you have not seen in tool results.`;

export async function runAgent({ goal, element, tabId, settings, onStep, maxSteps = 10 }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Selected element: ${JSON.stringify(element)}\n\nRequest: ${goal}` }
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
