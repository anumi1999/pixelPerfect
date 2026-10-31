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

When a Figma design is loaded and the request is about matching the design ("match the design", "this doesn't look like Figma", or no specific value given):
- Call get_figma_match on the selected element. If it is not confident, name the top candidates in your answer and stop, so the developer can confirm.
- Call get_figma_spec for the match. Its checks are the acceptance criteria: run verify with them first to list the mismatches, fix each one, then verify with the same checks until they all pass.
- Report each mismatch you fixed as "property: was → now (design value)".

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

Turning the verified preview into a source change:
9. Find the real file: use the source shown by get_matched_rules or the element's data-pp-src. If it is a built file (e.g. index-abc123.css) or missing, use find_in_source with the selector.
10. read_file before editing. Then you MUST call propose_source_edit with "find" copied exactly from the file. Do not write the source change only in your answer: the developer can only apply a change you proposed with the tool. Nothing is written until the developer clicks "Apply to code"; pixelPerfect then re-verifies on the real code. Propose one fix, not alternatives.
11. Write fixes a teammate would accept:
   - Change the rule that CAUSES the problem. Do not add a new overriding rule on top of it.
   - Reuse existing design tokens and variables (search with find_in_source for "--" or read the tokens file) instead of hard-coded values.
   - No !important, no inline styles, no new one-off selectors. Keep the diff as small as possible.
   - The preview used inline !important styles only to test; the source fix must not.
12. If the bridge is not available, skip steps 9–11 and give the source fix in your answer.

Finish with a short answer in this format:
   CAUSE: one or two sentences naming the rule and file.
   FIX: what you proposed (file:line and the change), or the exact change to make if no bridge.
   VERIFIED: the verify lines (✓/✗ with numbers), including responsive results.
   NOT TESTED: what verify did not cover (e.g. other pages, hover/focus/error states, interactions, other browsers).
Keep tool calls focused. Do not invent files or selectors that you have not seen in tool results.`;

// Returns { text, verified, stoppedEarly }.
// `verified` is true only if the most recent verify call passed. Auto mode uses it to decide on escalation.
export async function runAgent({ goal, element, tabId, settings, onStep, context = '', maxSteps = 30 }) {
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Selected elements (by index): ${JSON.stringify(element)}\n${context}\nRequest: ${goal}` }
  ];
  let verified = false;
  let readSource = false;     // read_file worked, so the bridge is up
  let proposed = false;       // propose_source_edit succeeded
  let reminded = false;
  let currentPreview = null;   // the preview now on the page (name + args)
  let verifiedPreview;         // the preview that was on the page when verify last passed

  for (let step = 1; step <= maxSteps; step++) {
    onStep({ kind: 'thinking', step });
    const reply = await callMuseSpark(messages, settings);

    if (!reply.tool_calls?.length) {
      // Safety net: a verified fix, a readable source file, but no proposed edit. Remind once.
      if (verified && readSource && !proposed && !reminded) {
        reminded = true;
        onStep({ kind: 'note', text: 'The agent wrote the fix in its answer instead of proposing it. Asking it to propose the change so you can apply it.' });
        messages.push({ role: 'assistant', content: reply.content || '' });
        messages.push({ role: 'user', content: 'You verified the fix and read the source file, but did not call propose_source_edit. Call propose_source_edit now with the single fix you recommend ("find" copied exactly from read_file), then give your final answer.' });
        continue;
      }
      onStep({ kind: 'final', text: reply.content || '(no answer)' });
      return { text: reply.content, verified, stoppedEarly: false };
    }

    messages.push(reply);
    for (const call of reply.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      onStep({ kind: 'tool', name: call.function.name, args });

      const result = await runTool(tabId, call.function.name, args);
      onStep({ kind: 'result', name: call.function.name, result });
      const name = call.function.name;
      if (name === 'verify' || name === 'verify_responsive') {
        verified = result?.allPass === true;
        if (verified) verifiedPreview = currentPreview;
      }
      if (name.startsWith('preview') && !result?.error) {
        // Re-applying the exact preview that already passed verify keeps it verified.
        const sorted = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'element' || args.element !== 0).sort(([a], [b]) => a.localeCompare(b)));
        currentPreview = `${name}:${JSON.stringify(sorted).replace(/\s+/g, ' ')}`;
        verified = currentPreview === verifiedPreview;
      }
      if (name === 'undo_preview') { currentPreview = null; verified = false; }
      if (call.function.name === 'read_file' && result && !result.error) readSource = true;
      if (call.function.name === 'propose_source_edit' && result?.proposed) proposed = true;

      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  const msg = `Stopped after ${maxSteps} steps without finishing. Handing back to you.`;
  onStep({ kind: 'final', text: msg });
  return { text: msg, verified, stoppedEarly: true };
}

// One chat-completions call with tools. Works for Muse Spark on the Meta Model API
// and for Muse Glimmer on a local llama.cpp server: both use the same format.
export async function callMuseSpark(messages, { apiKey, model, baseUrl }, withTools = true) {
  let res;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      messages,
      ...(withTools ? { tools: TOOLS, tool_choice: 'auto' } : {})
    })
    });
  } catch (err) {
    const local = /127\.0\.0\.1|localhost/.test(baseUrl);
    throw new Error(local
      ? `Can't reach the local model at ${baseUrl}. Is llama-server running? (${err.message})`
      : `Can't reach ${baseUrl}: ${err.message}`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${baseUrl} returned ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error(`Unexpected API response: ${JSON.stringify(data).slice(0, 300)}`);
  return msg;
}