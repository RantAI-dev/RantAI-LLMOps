/** "p12" for a single page, "p12–18" for a range. */
export function pageRange(start: number, end: number): string {
  return start === end ? `p${start}` : `p${start}–${end}`;
}
