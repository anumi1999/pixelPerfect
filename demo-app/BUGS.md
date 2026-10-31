# Planted bugs (for testing and the demo)

Keep this file out of the agent's way: the bridge's file search skips `*.md`.

| # | Where you see it | What's wrong | Cause | Expected fix |
|---|---|---|---|---|
| 1 | "Trail Runner" (featured) card | Padding is 16px; design says 24px | `.product-card.featured { padding: 16px }` in `Featured.css` overrides `.product-card` (higher specificity) | Remove the padding override in `Featured.css` |
| 2 | Card titles | Regular weight; design says semibold (600) | `.product-card__title { font-weight: var(--weight-regular) }` | Use `var(--weight-semibold)` |
| 3 | "Add to cart" buttons | 4px corners; design says 8px | `border-radius: 4px` in `ProductCard.css` | Use `var(--radius-md)` |
| 4 | Long product name | Text spills out of the card | `white-space: nowrap` with no overflow handling | Allow wrapping, or ellipsis |
| 5 | Price | Low contrast (#b4b4b4 on white, about 2:1) | `.product-card__price { color: #b4b4b4 }` | Use `var(--color-muted)` |
| 6 | Pagination row | Controls spread to both edges; design centers them as a group | `justify-content: space-between` in `Pagination.css` | `justify-content: center` |
| 7 | Checkout button | Covered by the free-shipping toast, can't be clicked | `.promo-toast` is fixed bottom-right with a higher z-index | Move the toast above the checkout bar |

Good demo prompts:
- Select the featured card → "padding should be 24px like the other cards"
- Select the pagination row → "center these controls"
- Select the Checkout button → "I can't click this"
- Select a card → "make this match the design" (with Figma loaded)
