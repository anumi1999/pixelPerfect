# pixelPerfect

An AI agent in your browser that inspects your running app, finds why the UI doesn't match the design or your request, fixes it in your source code, and verifies the result with measurable checks.

Built during the **Meta Global AI Developer Hackathon** (Oct 27 – Nov 4, 2026), Build for Your World track. Inspired by my earlier prototype, Fixel v0.2; all code in this repository is new and was written during the hackathon.

## What it does

1. Pick what's wrong in the page: one element, several (Shift+click), or a whole block (↑ selects the parent).
2. Describe it: "center these controls", "padding should be 24px", or "make this match the design".
3. The agent (Muse Spark) inspects the live page: measurements, matched CSS rules with their source files, React components.
4. With a Figma design loaded, it finds the matching design component by itself and turns its values into checks.
5. It writes checks for the request, confirms they fail, previews a fix, verifies, retries if needed, and checks 375 / 768 / 1280 px.
6. It reads your real source file and proposes the smallest edit, reusing your design tokens.
7. You compare original vs changed in the page, read the diff, and click **Apply to code**.
8. The bridge writes the file, Vite hot-reloads, and pixelPerfect re-runs the checks on the real code. **Undo** restores the file.

## Run the demo (about 10 minutes)

You need Node 18+ and Chrome.

```bash
# First time only
cd bridge && npm install && cd ../demo-app && npm install

# Terminal 1: the demo shop
cd demo-app && npm run dev                      # http://localhost:5173

# Terminal 2: the bridge (prints a token that stays the same every time)
node bridge/index.js ./demo-app
```

3. Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → choose `extension/`.
4. Open the pixelPerfect side panel → **Settings**: Meta API key and model (Cloud), the bridge token (first time only), then **Save** (the trace shows "Bridge connected") and **Test current mode**. Optional: Figma link and personal access token, then **Load design**.
5. Open `http://localhost:5173`, click **Pick elements**, pick the featured "Trail Runner" card, and ask: *padding should be 24px like the other cards*.

### Using pixelPerfect on your own project (no changes to your app)

```bash
node bridge/index.js /path/to/your/project
```

The bridge prints a pairing token and saves it in `~/.pixelperfect/bridge-token`. Paste it into Settings **once**; it stays the same every time you start the bridge. Without the optional plugin, pixelPerfect still finds source files through Vite's stylesheet paths, React's component source locations, and `find_in_source`.

**Optional, for Vite + React projects:**
- `ppSourceBabel` tags every element with its exact file and line (the demo shop uses it; see `demo-app/vite.config.js`).
- `pixelPerfect()` makes `npm run dev` start the bridge and pair automatically, so there's no second terminal. Don't use it together with a manually started bridge: both use port 7777.

Both are dev only; nothing reaches production builds.

**How automatic pairing stays safe:** the plugin only runs on the dev server (`apply: 'serve'`), never in builds. The extension only accepts the hint from a page served from your machine, pointing at a bridge on your machine. The bridge still refuses any connection that isn't from a Chrome extension.

### Figma design for the demo

Make one frame in Figma that matches `demo-app/src/styles/tokens.css`: a **Product Card** with vertical auto layout, 24px padding, 12px gap, 12px corners, white fill; a title text (18px, weight 600); a price text (16px, #5f5e6b); and a **Button** frame (12/16px padding, 8px corners, #4f46e5) with the text "Add to cart". Use the same product names as the demo so matching works by text. Copy the frame's link (right-click → Copy link to selection) into Settings.

## Model modes

- **Cloud:** Muse Spark through the Meta Model API.
- **Local:** an open-weights model on your laptop (Muse Glimmer via `scripts/start-glimmer.sh`, needs ~32 GB on a Mac). Nothing leaves the laptop.
- **Auto:** local first; if it can't produce a fix that passes verify, escalate to Muse Spark, only if you allowed it in Settings.

What always stays local: evidence collection and previews (in your browser) and file edits (the bridge, on your machine). Only model inference can leave the laptop, in Cloud mode or after escalation in Auto.

## What "verified" means

The checks listed in the answer passed, at the screen widths tested, in the page state you were looking at. It does not prove the whole app is correct: other pages, states (errors, loading, open menus), interactions and browsers are not tested, and the agent lists what it didn't test.

## How it works

| Part | File | Job |
|---|---|---|
| Agent loop | `extension/agent.js` | Muse Spark picks a tool, the extension runs it, repeats until verified |
| Tools | `extension/tools.js` | Tool descriptions the model sees, and how each runs |
| Page eyes | `extension/content.js`, `page-main.js` | Picker, measurements, matched rules, components, previews |
| Checks | `extension/verify.js` | css, centered, size, spacing, aligned, visible (not covered), no_overflow, contrast; regression warnings |
| Design | `extension/figma.js` | Load a Figma frame, match components, design values → checks |
| Bridge client | `extension/bridge.js` | WebSocket to the local bridge |
| Bridge | `bridge/index.js` | Find, read, check, apply and undo source edits in one project folder |
| Source tags | `vite-plugin/index.js` | Adds `data-pp-src="file:line"` to elements in dev |

**Agent tools:** `inspect_element`, `get_structure`, `get_matched_rules`, `get_component`, `preview_css`, `preview_stylesheet`, `undo_preview`, `verify`, `verify_responsive`, `get_figma_match`, `get_figma_spec`, `find_in_source`, `read_file`, `propose_source_edit`, `withdraw_source_edit`.

**Bridge safety:** listens on 127.0.0.1 only; refuses connections that aren't from a Chrome extension; requires the pairing token; only touches source files inside the project folder (never `node_modules`, `.git`, `dist`); every write is all-or-nothing and undoable.

## Built during the hackathon

- [x] Extension: side panel, picker with multi-select and parent selection, trace timeline
- [x] Evidence tools: measurements, block structure, matched CSS rules with source files, React/Vue component
- [x] Agent loop with Muse Spark tool calling
- [x] Live previews (one element or a stylesheet for a block), undo, original-vs-changes review
- [x] Verify: 8 check types, regression warnings, responsive checks at 3 widths, retry rules
- [x] Bridge: find, read, propose, apply and undo source edits; open in VS Code
- [x] Apply to code with re-verification on the real code after hot reload
- [x] Figma: load a frame, auto-match the selected element, design values become checks
- [x] Local / Auto / Cloud model modes
- [x] Demo shop with 7 planted bugs and a source-tagging Vite plugin

**Next:** Muse Spark vision to confirm Figma matches visually; "Break it" mode (failing APIs, empty data, long text); console and network root causes; Muse Code via MCP.

## What didn't work (dev log)

- **Built CSS hides the real file.** On a production build, matched rules point at `index-<hash>.css`, so the agent guessed the source file name. Fix: test on the dev server, plus `find_in_source` in the bridge.
- **The model reported success it never measured.** Fix: a `verify` tool, and a rule that success requires a passing verify.
- **The agent fixed the wrong scope.** Asked to revamp a whole block, it changed the one SVG path I had clicked. Fix: multi-select and parent selection, `get_structure`, stylesheet previews, and a rule to match the request's scope.
- **Checks restated the fix.** The agent verified "fill is white" after setting fill to white. Fix: checks must describe the intent and be written before the change.
- **`space-between` fooled the centering check.** Children spanning the full width have 0px gaps at both ends. Fix: centering children also requires them to sit together.
- **Backticks in the system prompt broke the build.** The prompt lives in a JavaScript template string. Caught by the end-to-end test.
- **Muse Spark wrote the fix in its answer instead of proposing it.** On the first real run it diagnosed the bug perfectly and read the file, but skipped `propose_source_edit`, so there was nothing to apply. Fix: a firmer prompt, plus a safety net in the loop that reminds the model once when it has a verified fix and a readable file but no proposed edit.
- **The agent "fixed" something that was already correct.** The card already had 24px padding, yet the agent proposed adding `padding: var(--space-6)`. The safety net that reminds it to propose had pushed it into inventing a change. Fix: the reminder only fires after a check has failed, and `propose_source_edit` is refused when every check passed before any change.
- **Running the bridge in a second terminal was friction.** Fix: the Vite plugin starts it with `npm run dev` and pairs the extension through a dev-only meta tag. First attempt failed because Vite bundles its config and choked on the bridge's `#!` line; loading the bridge at runtime fixed it.
- **Planted-bug comments would have given the answers away.** The agent reads source files, so the bug list moved to `BUGS.md`, which the bridge never opens.