---
name: Precision Logistics
colors:
  surface: '#f9f9f9'
  surface-dim: '#dadada'
  surface-bright: '#f9f9f9'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f4'
  surface-container: '#eeeeee'
  surface-container-high: '#e8e8e8'
  surface-container-highest: '#e2e2e2'
  on-surface: '#1a1c1c'
  on-surface-variant: '#43474b'
  inverse-surface: '#2f3131'
  inverse-on-surface: '#f0f1f1'
  outline: '#73787b'
  outline-variant: '#c3c7cb'
  surface-tint: '#4f616d'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#0b1e28'
  on-primary-container: '#748693'
  inverse-primary: '#b6c9d7'
  secondary: '#006d3b'
  on-secondary: '#ffffff'
  secondary-container: '#8cf9af'
  on-secondary-container: '#00743f'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1c1c18'
  on-tertiary-container: '#85847e'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d2e5f3'
  primary-fixed-dim: '#b6c9d7'
  on-primary-fixed: '#0b1e28'
  on-primary-fixed-variant: '#374954'
  secondary-fixed: '#8cf9af'
  secondary-fixed-dim: '#6fdc95'
  on-secondary-fixed: '#00210e'
  on-secondary-fixed-variant: '#00522b'
  tertiary-fixed: '#e5e2db'
  tertiary-fixed-dim: '#c9c6c0'
  on-tertiary-fixed: '#1c1c18'
  on-tertiary-fixed-variant: '#474742'
  background: '#f9f9f9'
  on-background: '#1a1c1c'
  surface-variant: '#e2e2e2'
  success-light: '#E6F2ED'
  ink-subtle: '#4A5568'
  border-subtle: '#E2E8F0'
typography:
  display-lg:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-md:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  button-text:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 4px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style
The design system is built for a high-performance B2B SaaS environment where reliability and clarity are paramount. The brand personality is professional, industrious, and authoritative, evoking the feeling of a well-oiled machine.

The visual style follows a **Corporate / Modern** aesthetic with a strong emphasis on data density and information hierarchy. It leverages high-contrast typography, a restrained but purposeful color palette, and structured card-based layouts to ensure complex operational data remains accessible and actionable. The interface should feel "heavy" in its utility but "light" in its execution through generous whitespace and crisp structural lines.

## Colors
The color palette is anchored by a deep "Midnight Blue" (`#071A24`) which provides a sense of stability and institutional trust. This serves as the primary color for navigation, headings, and high-impact UI components. 

A vibrant "Signal Green" (`#00884B`) is used as a secondary accent to denote action, success, and positive status updates. The tertiary "Sand" (`#F6F3EC`) provides a warm, low-contrast alternative to pure white for background segmentation and subtle grouping. The palette is designed for a light-mode-first experience to ensure maximum legibility for long-duration task management.

## Typography
The typography strategy uses a mix of three distinct typefaces to separate intent. **Space Grotesk** is used for headlines and display elements, providing a geometric, slightly technical edge that resonates with logistics and engineering. 

**Hanken Grotesk** serves as the primary workhorse for body text and interface elements, chosen for its exceptional legibility and modern proportions. **JetBrains Mono** is utilized sparingly for data points, labels, and status indicators, reinforcing the "systematized" nature of the product. Use uppercase for `label-caps` to distinguish secondary metadata.

## Layout & Spacing
This design system employs a **Fixed Grid** model for desktop to maintain structural integrity across wide monitors, centered within the viewport. A strict 4px / 8px baseline grid is used to govern all internal spacing.

Layouts are primarily composed of 12-column structures on desktop and 4-column structures on mobile. Card components should span logical column groups (e.g., 3-3-3-3 for stats, 8-4 for main content vs. sidebar). Spacing between cards and sections should be consistent at 24px (gutter) to ensure the UI feels organized and breathable.

## Elevation & Depth
Depth is conveyed through **Tonal Layers** and extremely **Ambient Shadows**. Instead of heavy shadows, the system uses "Layered Surfaces":
- **Level 0 (Background):** Pure White (`#FFFFFF`) or Sand (`#F6F3EC`).
- **Level 1 (Cards):** Pure White with a 1px border (`#E2E8F0`) and a soft, low-opacity shadow (4px Blur, 2% Opacity, #071A24).
- **Level 2 (Interactive/Floating):** Higher elevation with a more pronounced shadow (12px Blur, 6% Opacity) to indicate active states or modals.

This approach creates a flat, professional look that avoids the "muddiness" of traditional skeuomorphism.

## Shapes
The shape language is **Soft (0.25rem)**. This subtle rounding provides a modern touch without sacrificing the professional "squareness" required for a technical B2B tool. Smaller components like buttons and inputs use the base 4px radius, while larger containers like cards may scale up to 8px (`rounded-lg`) to soften the overall interface composition.

## Components
- **Buttons:** Primary buttons use the Midnight Blue background with white text. Secondary buttons use a transparent background with a 1px Midnight Blue border.
- **Cards:** Cards are the primary container. They must feature a 1px border (`#E2E8F0`) and no inner padding less than 24px.
- **Inputs:** Text fields should be utilitarian with a light gray border that thickens and turns Midnight Blue on focus. Labels should always be visible above the field using `label-caps`.
- **Status Chips:** Use rounded-pill shapes with the "Success Green" for active states, utilizing a light tint (`#E6F2ED`) for the background and dark text for contrast.
- **Data Tables:** Tables should be borderless on the rows, using only subtle horizontal dividers. Header rows should use the Tertiary Sand background to provide clear visual separation from the data.
- **KPI Widgets:** Distinctive cards used for high-level metrics, featuring a large `headline-lg` value and a `label-caps` description.