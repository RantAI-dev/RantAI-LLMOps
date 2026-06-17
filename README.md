# Next.js + shadcn/ui Base Project

Base project ini disiapkan untuk kebutuhan slicing UI dari Figma dengan fondasi yang fleksibel, scalable, dan mudah di-maintain.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS v4
- shadcn/ui
- class-variance-authority (CVA) untuk variant component

## Jalankan Project

```bash
npm install
npm run dev
```

## Struktur Folder

```txt
src/
  app/                    # Next.js App Router
  components/ui/          # Shared shadcn UI primitives
  lib/                    # Shared utilities
  hooks/                  # Shared hooks
  types/                  # Shared types
  styles/                 # Design tokens
  modules/
    tasks/                # Feature module (1 folder per module)
      components/         # 1 file per component
      hooks/
      lib/
      data/
      constants/
      types.ts
      index.ts            # Public exports
```

## Design System Foundation

- Token warna, typography, spacing, dan radius ada di `src/styles/design-tokens.css`
- Integrasi token ke Tailwind/shadcn ada di `src/app/globals.css`
- Pattern reusable component:
  - `components/ui/button.tsx` (shadcn + CVA)
  - `components/ui/typography.tsx` (typography variant)
  - `components/ui/surface.tsx` (container/surface variant)

## Catatan

- Belum ada design final; ini hanya fondasi.
- Saat file/screenshot Figma tersedia, komponen bisa disesuaikan lewat props, variant, dan utility classes tanpa hard-coding style final.
