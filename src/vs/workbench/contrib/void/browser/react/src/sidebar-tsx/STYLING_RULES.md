# Sidebar Styling Rules

> **Read this before writing any Tailwind classes in this directory.**

---

## 🚨 THE MOST COMMON CSS BUG: Color Opacity Modifiers on CSS Variables

### The Broken Pattern

```tsx
// ❌ NEVER DO THIS — silently generates no CSS, border disappears
<div className="border-void-border-3/40" />
<div className="bg-void-bg-2/50" />
<div className="text-void-fg-3/70" />
```

### Why It Breaks

Tailwind's `/opacity` color modifier syntax (e.g. `bg-red-500/40`) **only works when the color is defined as RGB channels** in `tailwind.config.js`.

All `void-*` colors are defined as **plain CSS variable strings**:
```js
// tailwind.config.js
'void-border-3': 'var(--void-border-3)',  // ← plain CSS var, not RGB channels
```

These CSS variables resolve to VSCode theme hex values at runtime. Tailwind cannot inject an alpha channel into them at build time, so the `/40` modifier **silently produces no output**.

### The Fix

Use `opacity-*` on the element instead:
```tsx
// ✅ CORRECT — wrapper opacity or Tailwind standard opacity utilities
<div className="border-l border-void-border-3 opacity-40" />

// ✅ Or if you only want to dim the border without affecting children:
<div className="border-l border-void-border-3" style={{ opacity: 0.4 }} />
```

---

## Tailwind Opacity Scale — Use Only Standard Values

Tailwind JIT supports all values, but for consistency use multiples of **5** or **10**:

| ✅ Use | ❌ Avoid |
|--------|---------|
| `opacity-25` | `opacity-22`, `opacity-27` |
| `opacity-40` | `opacity-35`, `opacity-37` |
| `opacity-50` | `opacity-45`, `opacity-55` |
| `opacity-60` | `opacity-55`, `opacity-65` |
| `opacity-75` | `opacity-70` is fine |

---

## Design Language for This Sidebar

All UI elements follow a **flat, minimal** design system:

### Status Indicators
```tsx
// Static dot — no animation/pulse/ping for normal states
<span className="w-[5px] h-[5px] rounded-full bg-void-fg-4 opacity-40 flex-shrink-0" />
```

### Thinking / Active State
```tsx
// Use an em-dash, not a pulsing dot
<span className="text-[11px] text-void-fg-4 opacity-25 select-none">&mdash;</span>
```

### Collapsible Rows
```tsx
// Header: dot + text + right-side chevron
// No boxes, no backgrounds, no heavy borders
<div className="flex items-center gap-1.5 cursor-pointer">
  <span className="w-[5px] h-[5px] rounded-full bg-void-fg-4 opacity-40" />
  <span className="text-[12px] text-void-fg-3">Title</span>
  <ChevronRight className="ml-auto text-void-fg-4 opacity-40 h-3 w-3" />
</div>
```

### Expanded / Indented Content
```tsx
// Left border line, NOT a box or background
<div className="ml-2 pl-2 border-l border-void-border-3">
  {content}
</div>
```

### Typography Scale
| Use | Size | Color | Opacity |
|-----|------|-------|---------|
| Primary label | `text-[12px]` | `text-void-fg-2` | 100% |
| Secondary / desc | `text-[11px]` | `text-void-fg-4` | 60% |
| Metadata / mono | `text-[10px]` | `text-void-fg-4` | 50-60% |
| Thinking label | `text-[11px]` | `text-void-fg-4` | 50% |

---

## What We Already Removed

Avoid re-introducing these patterns — they were removed intentionally:

- ❌ `border border-void-border-3/60 rounded bg-void-bg-3/50` (heavy tool card boxes)
- ❌ `animate-ping` green status dots
- ❌ `animate-pulse` colored indicators
- ❌ `border border-void-widget-border rounded px-2.5 py-1.5` agent cards
- ❌ Colored pill badges for agent roles
- ❌ `ArrowRight` chevrons for question/answer labels

These were replaced with the flat dot + text + left-border pattern above.
