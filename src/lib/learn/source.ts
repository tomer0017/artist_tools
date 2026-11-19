// A save or an export made from a Learn item's reference names that item
// (ADR-0018), so the server refuses it once the item is no longer open to the
// account (/api/usage, `learnItem`). Anything else is sent exactly as before.

/** `{ learnItem }` when the picture came from a Learn item, nothing otherwise. */
export const fromLearn = (learnItem: string | null | undefined): { learnItem?: string } => (learnItem ? { learnItem } : {});
