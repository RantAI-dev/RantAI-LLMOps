/**
 * The shared typography scale. Every feature module's `*Ui` object delegates here
 * so the body/title/section/metric/label class strings live in exactly one place.
 * (Module `constants/*-ui.ts` files re-export this as their own named object and
 * add only module-specific extras like select/field class names.)
 */
export const textUi = {
  body: "text-sm leading-5",
  title: "text-2xl font-semibold leading-8 tracking-tight",
  subheading: "text-base leading-6 text-ink-soft",
  section: "text-lg font-semibold leading-7 tracking-tight",
  metric: "text-2xl font-semibold leading-8 tabular-nums tracking-tight",
  label: "text-xs font-medium text-ink-soft",
  detailTitle: "text-lg font-semibold leading-tight text-primary",
} as const;
