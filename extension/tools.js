// The tools the agent can call. Each has:
//  1. a JSON description (so Muse Spark knows when and how to use it)
//  2. code that runs it (here: forwarded to content.js in the page)

export const TOOLS = [
  fn('inspect_element',
    'Measure the selected element: its box (position and size), key computed styles, inline style, parent layout and HTML.'),
  fn('get_matched_rules',
    'List the CSS rules that apply to the selected element, in source order, with the file each comes from and any @media condition. Use this to find WHY a style has its value.'),
  fn('get_component',
    'Get the React/Vue component that rendered the selected element, its props, and its source file and line if available.'),
  fn('preview_css',
    'Apply CSS declarations live to the selected element as a preview (not saved to code). Returns the resulting styles.',
    { css: { type: 'string', description: 'CSS declarations, e.g. "padding: 24px; font-weight: 600"' } },
    ['css']),
  fn('undo_preview', 'Revert the most recent preview_css.')

  // TODO (Day 4): add `verify` here. Suggested shape:
  // fn('verify', 'Check the selected element against expected values and report pass/fail for each.',
  //    { checks: { type: 'array', items: { type: 'object', properties: {
  //        property: { type: 'string' }, expected: { type: 'string' }, tolerance_px: { type: 'number' } } } } },
  //    ['checks'])
  // ...then handle 'verify' in content.js runTool().
];

// Runs a tool by name. All current tools live in the page (content.js).
export async function runTool(tabId, name, args) {
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: 'PP_TOOL', name, args });
    return result ?? { error: 'No response from the page. Reload the page and pick the element again.' };
  } catch (err) {
    return { error: `Could not reach the page: ${err.message}` };
  }
}

function fn(name, description, properties = {}, required = []) {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}
