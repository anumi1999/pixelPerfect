# NOVA Analytics — pixelPerfect benchmark

A deliberately complex React + Vite SaaS analytics dashboard for testing pixelPerfect's Figma matching, source mapping, root-cause diagnosis, live preview, source patching and responsive verification.

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The project intentionally includes seven visual defects in `src/styles.css`. Do not remove the `INTENTIONAL DEFECTS` section before testing.

## Figma reference

Import `figma-reference.svg` into Figma (File → Place image, or drag the SVG onto a canvas). It is the intended target design for the dashboard. Use the 1440 × 1000 frame as the desktop reference. The React app is intentionally different from the reference in several places.

## Suggested test sequence

1. Compare the page title and insight banner spacing.
2. Inspect the campaign panel padding and identify the winning CSS selector.
3. Check KPI card typography and icon collision.
4. Inspect traffic source legend width and alignment.
5. Test campaign table overflow at tablet width.
6. Inspect activity icon alignment.
7. Check the dashboard column layout at 768px and 375px.

## Intentional defect inventory (for evaluator only)

| ID | Area | Intended target | Planted defect |
|---|---|---|---|
| 1 | Insight banner | 70px tall, readable two-line copy | Compressed to 54px, tight line-height |
| 2 | Campaign panel | 17px horizontal padding | Late selector overrides to 9px |
| 3 | KPI values | 21px, fit within card | 25px, causing narrow-card crowding |
| 4 | Traffic sources | Legend fits beside donut | Excess gap and forced min-width |
| 5 | Campaign table | No horizontal overflow at 768px | Excessive last-column padding |
| 6 | Activity feed | Icons vertically aligned to text | 7px top margin |
| 7 | Tablet layout | Single column below 900px | Two-column layout persists until 760px |

These are intentionally visible defects. The Figma reference represents the desired appearance; use pixelPerfect to diagnose and repair the actual CSS rather than editing the inventory manually.
