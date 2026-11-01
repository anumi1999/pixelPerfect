// THE AGENT LOOP.
// Muse Spark decides which tool to call next; this file runs the tool,
// sends the result back, and repeats until the model gives a final answer.
import { TOOLS, runTool, sourceStatus } from './tools.js';

const SYSTEM_PROMPT = `You are pixelPerfect, a senior frontend engineer working inside the developer's browser.
The developer has selected one or more elements on their running web app (numbered by index) and describes what is wrong or what should change.

First, understand the INTENT:
- A fix to one element ("center this", "wrong padding") → work on that element with preview_css.
- A change to a whole block, several elements, or a redesign ("make this section look like a card", "revamp this") → call get_structure on the selected container first, then change it with preview_stylesheet using the real selectors you saw. Do not reduce a block-level request to a fix of one child element.
- If the request is ambiguous, state your interpretation in one sentence at the start of your final answer.

When a Figma design is loaded and the request is about matching the design ("match the design", "this doesn't look like Figma", or no specific value given):
- Call get_figma_match on the selected element. If it is not confident, name the top candidates in your answer and stop, so the developer can confirm.
- Design values come from Figma or from the developer, never from comments or notes in the code.
- For requests that are not about the design (e.g. "the padding differs from the other cards"), do not use the Figma tools: compare with the page itself (the other cards, the shared rule).
- Never change the page's content or markup (text, icons, elements) just to make a check's target match. If a check cannot find its target, say so; do not rewrite the UI to satisfy it.
- Call get_figma_spec for the match. Its checks are the acceptance criteria: run verify with them first to list the mismatches, fix each one, then verify with the same checks until they all pass.
- Report each mismatch you fixed as "property: was → now (design value)".

How to work:
1. Always inspect first (inspect_element or get_structure), then find the cause (get_matched_rules, get_component). Never guess values you can measure.
2. Find WHY the style has its current value: which rule, which file, and why it wins (specificity, source order, inline style, media query).
   Be efficient: call verify within your first 3 tool calls. Do not read source files or search the project until verify has confirmed there is a problem.
3. Before changing anything, call verify with checks that describe the request (e.g. centered, css, spacing). It should FAIL, confirming the problem. If it already passes, the request is already met: do not preview or propose anything; answer "Already matches" with the verify numbers and stop.
4. Propose the smallest change that meets the intent and try it with preview_css or preview_stylesheet.
5. Call verify again with the SAME checks. If any check fails, undo_preview, think about why, and try a different fix. At most 3 attempts.
   Use the SAME checks with the SAME expected values. Never drop a check that failed or change an expected value to match what you measured; pixelPerfect does not count such a verify as passing.
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
   - If a later rule overrides an earlier, correct one, delete the later override instead of copying the correct values into it.
   - Don't force a layout with hacks (white-space: nowrap + ellipsis to make text one line, fixed heights to match a size): remove what causes the problem (e.g. a max-width).
   - Every declaration in your proposal must be needed by a check. Don't add properties that do nothing (e.g. row-gap on an element that is not flex or grid).
   - Reuse existing design tokens and variables (search with find_in_source for "--" or read the tokens file) instead of hard-coded values.
   - No !important, no inline styles, no new one-off selectors. Keep the diff as small as possible.
   - The preview used inline !important styles only to test; the source fix must not.
   - Never use generated or hashed class names (e.g. css-1a2b3c, cache-19gq8pv, [class*="…"]): they change on every build. Use stable classes, elements or attributes from the source.
   - Keep the change in scope: do not edit a shared token or global rule for a request about one block, unless the developer asked for a global change.
   pixelPerfect refuses proposals that add !important or hashed class names.
12. If the bridge is not available, or source tools say the page is not from the developer's local project, skip steps 9–11: do not search or edit files, and give the CSS in your answer.

Break it (stress testing):
- When the request starts with "Break it", the developer wants to find bugs BEFORE users do. Do not fix anything.
- Call stress_test once on the selected block (all attacks), then check_states once (hover, keyboard focus, pressed and disabled states, plus keyboard basics). For each attack that broke it, find the cause: inspect the elements named in the problems (get_structure, get_matched_rules) and name the rule and file that make it fragile (e.g. a fixed width, white-space: nowrap, no min-width: 0 on a flex child, no overflow-wrap, a fixed height).
- Answer in this format:
   BROKE: one line per broken attack: what happened (with the numbers) and the cause (rule and file).
   HELD: the attacks it survived, in one line.
   NOT TESTED: what stress_test and check_states did not try (e.g. error/loading states that need app data, slow network, screen-reader reading order, other pages).
- States: for a request about hover, focus or pressed styles ("the hover color is wrong", "I can't see focus"), use check_states to see the states, and verify with checks that have "state" (e.g. { type: "css", property: "outline-style", expected: "solid", state: "focus" }) to prove the fix.
- To FIX a break (a follow-up like "fix the long text break"): preview the fix, then run stress_test with that attack (it must now hold) AND verify that the normal page still looks the same (e.g. css checks on the values you changed, visible). Then propose the source edit as usual.

Sessions and follow-ups:
- The developer may send follow-up requests that refine your previous work, e.g. "only on the featured card" or "a bit darker". Use what you learned earlier in this conversation; re-inspect only what may have changed.
- Messages tell you whether your last change was applied to the code, undone or discarded. If it was applied, the source files now contain it: read_file again and propose edits against the CURRENT file. If a follow-up narrows an applied change, revert the shared part and add the narrower rule in the same proposal (several propose_source_edit calls are fine).
- To limit a change to one element among many that share a class, use a more specific selector that already exists (a modifier class like .featured, a parent, or an attribute), not inline styles.
- Run verify again for the follow-up: check both that the targeted element changed and that the others did not (select or target them as needed).

Finish with a short answer in this format:
   CAUSE: one or two sentences naming the rule and file.
   FIX: what you proposed (file:line and the change), or the exact change to make if no bridge.
   VERIFIED: the verify lines (✓/✗ with numbers), including responsive results.
   NOT TESTED: what verify did not cover (e.g. other pages, hover/focus/error states, interactions, other browsers).
Keep tool calls focused. Do not invent files or selectors that you have not seen in tool results.`;

// Returns { text, verified, stoppedEarly, messages }.
// `verified` is true only if the most recent verify call passed. Auto mode uses it to decide on escalation.
// Pass `history` (the messages returned by a previous run) to continue a session; `notes` describe what the
// developer did since (applied, undid, discarded).
export async function runAgent({ goal, element, tabId, settings, onStep, context = '', history = null, notes = [], maxSteps = 30 }) {
  const messages = history?.length
    ? [...history, { role: 'user', content: [
        'Follow-up request in the same session.',
        notes.length ? `Since your last answer: ${notes.join(' ')}` : '',
        `Selected elements now (by index): ${JSON.stringify(element)}`,
        context,
        `Request: ${goal}`
      ].filter(Boolean).join('\n') }]
    : [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Selected elements (by index): ${JSON.stringify(element)}\n${context}\nRequest: ${goal}` }
      ];
  let verified = false;
  let readSource = false;     // read_file worked, so the bridge is up
  let proposed = false;       // propose_source_edit succeeded
  let reminded = false;
  let currentPreview = null;   // the preview now on the page (name + args)
  let verifiedPreview;         // the preview that was on the page when verify last passed
  let sawFailure = false;      // some verify failed: there was something to fix
  let checked = false;         // a verify or break test has run
  let changedFirst = false;    // the agent previewed a change before its first check (e.g. a follow-up fix)
  let acceptance = null;       // the checks of the first failing verify: the bar a fix must clear
  let specAcceptance = null;   // the checks of the last Figma spec loaded: the fix must meet the design, not a subset
  let specPending = null;      // a spec that was loaded but not used yet: it locks once a verify uses any of its checks

  for (let step = 1; step <= maxSteps; step++) {
    onStep({ kind: 'thinking', step });
    const reply = await callMuseSpark(messages, settings);

    if (!reply.tool_calls?.length) {
      // Safety net: a verified fix, but no proposed edit while the code is reachable. Remind once.
      // (In a follow-up the agent may not re-read the file, so check the bridge directly.)
      if (verified && (sawFailure || changedFirst) && !proposed && !reminded && (readSource || (await sourceStatus(tabId)).ok)) {
        reminded = true;
        onStep({ kind: 'note', text: 'The agent wrote the fix in its answer instead of proposing it. Asking it to propose the change so you can apply it.' });
        messages.push({ role: 'assistant', content: reply.content || '' });
        messages.push({ role: 'user', content: 'You verified the fix, but did not call propose_source_edit, and the source files are available. read_file the file that causes the problem (again, if it may have changed), call propose_source_edit with the fix ("find" copied exactly from read_file), then give your final answer.' });
        continue;
      }
      onStep({ kind: 'final', text: reply.content || '(no answer)' });
      messages.push({ role: 'assistant', content: reply.content || '' });
      return { text: reply.content, verified, stoppedEarly: false, messages: compactHistory(messages) };
    }

    messages.push(reply);
    for (const call of reply.tool_calls) {
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
      onStep({ kind: 'tool', name: call.function.name, args });

      const name = call.function.name;
      // Guard: no source change when every check passed before anything was changed.
      const result = name === 'propose_source_edit' && !sawFailure && !changedFirst
        ? { error: 'Not proposed: every check already passed before any change, so the request is already met. Do not change the code. Tell the developer it already matches, with the verify numbers.' }
        : await runTool(tabId, name, args);
      if ((name === 'verify' || name === 'verify_responsive') && result && !result.error) {
        // Lock the acceptance checks: the first failing verify sets them. A later verify only counts
        // if it still includes every one of them with the same expected value (extra checks are fine).
        if (result.allPass === false && !acceptance) acceptance = new Map((args.checks || []).map((c) => [checkKey(c), JSON.stringify(c.expected ?? null)]));
        // The agent is working against the design once it checks any spec value; from then on, all of them count.
        if (specPending && (args.checks || []).some((c) => specPending.has(checkKey(c)))) { specAcceptance = specPending; specPending = null; }
        const changed = [
          ...(acceptance ? changedChecks(acceptance, args.checks || []) : []),
          ...(specAcceptance ? changedChecks(specAcceptance, args.checks || []).map((c) => `Figma spec ${c}`) : [])
        ];
        if (changed.length) {
          result.checksChanged = changed;
          result.note = `This does NOT count as verified. The original checks were dropped or loosened: ${changed.slice(0, 6).join('; ')}${changed.length > 6 ? ` and ${changed.length - 6} more` : ''}. Keep every original check with its original expected value (you may add checks). If one cannot pass for a reason outside the fix, say so in your answer and leave the fix unverified.`;
        }
        verified = result.allPass === true && !changed.length;
        if (verified) verifiedPreview = currentPreview;
        if (result && result.allPass === false) sawFailure = true;
      }
      if ((name === 'stress_test' || name === 'check_states') && result && !result.error) {
        // A break test is a check too: it fails when an attack breaks the block, passes when all hold.
        verified = result.allPass === true;
        if (verified) verifiedPreview = currentPreview;
        if (result.allPass === false) sawFailure = true;
      }
      if (['verify', 'verify_responsive', 'stress_test', 'check_states'].includes(name) && result && !result.error) checked = true;
      if (name.startsWith('preview') && !result?.error && !checked) changedFirst = true;
      if (name.startsWith('preview') && !result?.error) {
        // Re-applying the exact preview that already passed verify keeps it verified.
        const sorted = Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'element' || args.element !== 0).sort(([a], [b]) => a.localeCompare(b)));
        currentPreview = `${name}:${JSON.stringify(sorted).replace(/\s+/g, ' ')}`;
        verified = currentPreview === verifiedPreview;
      }
      if (name === 'undo_preview') { currentPreview = null; verified = false; }
      if (name === 'get_figma_spec' && Array.isArray(result?.checks) && result.checks.length) {
        specPending = new Map(result.checks.map((c) => [checkKey(c), JSON.stringify(c.expected ?? null)]));
        specAcceptance = null;
      }
      onStep({ kind: 'result', name, result });
      if (call.function.name === 'read_file' && result && !result.error) readSource = true;
      if (call.function.name === 'propose_source_edit' && result?.proposed) proposed = true;

      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  // Out of steps: ask once more, without tools, for the answer about what was done, so the developer
  // still gets CAUSE / FIX / VERIFIED / NOT TESTED instead of nothing.
  let msg = `Stopped after ${maxSteps} steps without finishing. Handing back to you.`;
  try {
    messages.push({ role: 'user', content: 'You are out of steps. Do not call tools. Give your final answer now in the usual format (CAUSE / FIX / VERIFIED / NOT TESTED), only about what you actually did and verified. Start with "Stopped at the step limit."' });
    const last = await callMuseSpark(messages, settings, false);
    if (last?.content) msg = last.content;
  } catch {}
  onStep({ kind: 'final', text: msg });
  messages.push({ role: 'assistant', content: msg });
  return { text: msg, verified, stoppedEarly: true, messages: compactHistory(messages) };
}

// A check's identity is everything except what it expects.
function checkKey(c) {
  const { expected, tolerance, ...rest } = c || {};
  return JSON.stringify(Object.fromEntries(Object.entries(rest).filter(([k, v]) => !(k === 'element' && v === 0)).sort(([a], [b]) => a.localeCompare(b))));
}

function changedChecks(acceptance, checks) {
  const now = new Map(checks.map((c) => [checkKey(c), JSON.stringify(c.expected ?? null)]));
  const out = [];
  for (const [key, expected] of acceptance) {
    const k = JSON.parse(key);
    const label = [k.type, k.property, k.target ? JSON.stringify(k.target) : ''].filter(Boolean).join(' ');
    if (!now.has(key)) out.push(`dropped "${label}"`);
    else if (now.get(key) !== expected) out.push(`"${label}" expected ${expected} → ${now.get(key)}`);
  }
  return out;
}

// Keeps a session small: older tool results are trimmed, and the oldest whole turns are dropped
// once the conversation gets long. Turns are cut at user messages so tool calls stay paired.
export function compactHistory(messages, { keepFullFromLastTurns = 1, maxToolChars = 1200, maxMessages = 120 } = {}) {
  const userIdx = messages.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
  const keepFrom = userIdx.length > keepFullFromLastTurns ? userIdx[userIdx.length - keepFullFromLastTurns] : 0;
  let out = messages.map((m, i) => (
    i < keepFrom && m.role === 'tool' && typeof m.content === 'string' && m.content.length > maxToolChars
      ? { ...m, content: m.content.slice(0, maxToolChars) + ' …(trimmed)' }
      : m
  ));
  while (out.length > maxMessages) {
    const users = out.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i > 0);
    if (users.length < 2) break;
    out = [out[0], ...out.slice(users[1])];   // drop the oldest turn, keep the system prompt
  }
  return out;
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