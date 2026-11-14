---
name: ui-design-systems
description: "Build and maintain UI design systems — token architecture, component APIs, variant patterns, and documentation workflows for design-engineering alignment."
license: MIT
---

A design system is a set of constraints that make UI predictable.
Without one, every feature adds visual drift. With one, every feature
feels like part of the same product.

## Token architecture

Design tokens are the atomic values — colors, spacing, typography,
shadows — that define your visual language. Organize them in three tiers:

```typescript
// tokens/primitives.ts — raw values
export const primitives = {
  color: {
    blue: { 50: '#eff6ff', 500: '#3b82f6', 900: '#1e3a8a' },
    gray: { 50: '#f9fafb', 500: '#6b7280', 900: '#111827' },
  },
  spacing: { 0: '0', 1: '0.25rem', 2: '0.5rem', 4: '1rem', 8: '2rem' },
  fontSize: { sm: '0.875rem', base: '1rem', lg: '1.125rem', xl: '1.25rem' },
};

// tokens/semantic.ts — purpose-driven aliases
export const semantic = {
  color: {
    background: primitives.color.gray[50],
    foreground: primitives.color.gray[900],
    primary: primitives.color.blue[500],
    'primary-foreground': '#ffffff',
    muted: primitives.color.gray[500],
    border: primitives.color.gray[200],
  },
  spacing: {
    xs: primitives.spacing[1],
    sm: primitives.spacing[2],
    md: primitives.spacing[4],
    lg: primitives.spacing[8],
  },
};

// tokens/component.ts — component-level tokens
export const component = {
  button: {
    height: { sm: '2rem', md: '2.5rem', lg: '3rem' },
    padding: { sm: '0.75rem', md: '1rem', lg: '1.25rem' },
    radius: '0.375rem',
  },
  input: {
    height: '2.5rem',
    padding: '0.5rem 0.75rem',
    borderWidth: '1px',
  },
};
```

## Component API patterns

Design compound components with clear prop interfaces:

```typescript
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'ghost' | 'danger';
  size: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

// Use discriminated unions for complex variants
type CardProps =
  | { variant: 'default'; elevation?: 'none' | 'low' | 'medium' }
  | { variant: 'interactive'; onClick: () => void }
  | { variant: 'skeleton'; width?: string; height?: string };
```

## Variant patterns with CVA

Use `cva` (class-variance-authority) for type-safe variants:

```typescript
import { cva, type VariantProps } from 'class-variance-authority';

const button = cva(
  'inline-flex items-center justify-center rounded-md font-medium transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-blue-600 text-white hover:bg-blue-700',
        secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
        ghost: 'hover:bg-gray-100',
        danger: 'bg-red-600 text-white hover:bg-red-700',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4 text-base',
        lg: 'h-12 px-6 text-lg',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);
```

## Documentation workflow

Every component needs:
1. **Usage examples** — copy-pasteable code blocks
2. **Prop table** — name, type, default, description
3. **Do / Don't** — visual guidelines with examples
4. **Accessibility** — keyboard nav, ARIA attributes, screen reader behavior

## File structure

```
src/
  tokens/
    primitives.ts
    semantic.ts
    component.ts
    index.ts
  components/
    Button/
      Button.tsx
      Button.test.tsx
      Button.stories.tsx
      index.ts
    Input/
      ...
  hooks/
    useControllableState.ts
    useDisclosure.ts
```

## Anti-patterns

- Don't use boolean props for multi-state variants — use enums
- Don't hardcode colors in components — always reference tokens
- Don't skip loading and error states — every async component needs them
- Don't export internal components — keep the public API minimal
