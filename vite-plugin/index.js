// pixelPerfect source tagging for React + Vite (dev only).
// Adds data-pp-src="src/components/Card.jsx:12:7" to every HTML element written in JSX,
// so the extension knows which file and line rendered what you click.
//
// Usage in vite.config.js:
//   import react from '@vitejs/plugin-react';
//   import { ppSourceBabel } from '../vite-plugin/index.js';
//   export default defineConfig(({ command }) => ({
//     plugins: [react({ babel: { plugins: command === 'serve' ? [ppSourceBabel] : [] } })]
//   }));
import path from 'node:path';

export function ppSourceBabel({ types: t }) {
  return {
    name: 'pixelperfect-source',
    visitor: {
      JSXOpeningElement(p, state) {
        const name = p.node.name;
        // Only host elements (div, button…), not components (<Card>) or fragments.
        if (name.type !== 'JSXIdentifier' || !/^[a-z]/.test(name.name)) return;
        if (p.node.attributes.some((a) => a.type === 'JSXAttribute' && a.name?.name === 'data-pp-src')) return;
        const loc = p.node.loc?.start;
        const file = state.file.opts.filename;
        if (!loc || !file || file.includes('node_modules')) return;
        const rel = path.relative(state.file.opts.root || process.cwd(), file).split(path.sep).join('/');
        p.node.attributes.push(
          t.jsxAttribute(t.jsxIdentifier('data-pp-src'), t.stringLiteral(`${rel}:${loc.line}:${loc.column + 1}`))
        );
      }
    }
  };
}
