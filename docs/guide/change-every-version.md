# How to change every version at once

Serves: **Change every version at once**.

## Who it's for and when to use it
For anyone with a component that has several sizes or states. Use it when a change should reach all of them, such as rounder corners, a new font size or a token swap, and also when one version needs to differ.

## Prerequisites
- A running session and a component with versions. Example: a Button with sizes small, medium and large, and states default, hover and disabled (9 versions).

## Flow

```text
            ┌──────────── Button base ────────────┐
            │  radius-hair → radius-hardware      │
            └──────────────┬──────────────────────┘
          change base once │
   ┌──────────┬────────────┼────────────┬──────────┐
   ▼          ▼            ▼            ▼          ▼
 small/def  small/hover  medium/...   large/...  (9 in all)
   all follow the base, unless a version overrides that property
   (an override shows a dot; "Reset to base" removes it)
```

## Steps

### Change all versions
1. Open the Button. The canvas shows a grid: sizes across, states down.
2. Click **Base** in the right panel (or press **B**).
3. Set **Radius** from `radius-hair` to `radius-hardware`.
4. All 9 Buttons update together.

Or ask your agent: "Round the corners of the napkin Button base to radius-hardware."

### Change one version only
1. Click the large / disabled Button.
2. Change its **Fill**. The panel shows a dot next to Fill: this version now overrides the base.
3. To undo the override, click the dot and pick **Reset to base**.

### Add a version
1. Click **+ Size** or **+ State** at the edge of the grid, and name it.
2. Or ask your agent: "Add an xl size to the Button."

## What you see when it worked
- All versions changed together, except ones with an override dot on that property.
- The file changed in one place, the base:
  ```console
  $ git diff components/Button.html
  -  --radius: var(--radius-hair);
  +  --radius: var(--radius-hardware);
  ```
  (Illustrative format: [GAPS.md](GAPS.md), G1.)

## Common problems and fixes
| Problem | Fix |
|---|---|
| One version didn't change | It overrides that property. Look for the dot and choose **Reset to base**. |
| You changed one version but meant all | You had a version selected, not **Base**. Undo with your editor or git, then select Base. |
| The agent edited every version one by one | Ask it to "change the base". The diff will be one line, not nine. |

## Limits
- Whether a base change always reaches every version is a reading of INTENT's "variants", not a confirmed rule ([GAPS.md](GAPS.md), G3). This page assumes it does, with per-version overrides.
- Versions live in one component file. Sharing a base between two components is not covered.
