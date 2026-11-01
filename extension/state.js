// Shared state between the agent's tools and the side panel.
export const state = {
  pendingEdits: [],        // source edits the agent proposed: { file, find, replace, reason, line, diff }
  lastPassingChecks: null, // the checks from the last verify that passed, re-run after applying to code
  lastStress: null         // the break-test attacks that last held, re-run after applying to code
};

export function resetRun() {
  state.pendingEdits = [];
  state.lastPassingChecks = null;
  state.lastStress = null;
}