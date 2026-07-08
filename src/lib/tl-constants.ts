/**
 * Shared Transformer Lab identifiers used across the BFF libs.
 *
 * `FINETUNE_EXPERIMENT` MUST be the same value everywhere it's referenced: the
 * eval flow and the Tasks list both look fine-tune jobs up under this exact
 * experiment, so a divergent copy would silently break cross-feature lookups.
 * Keeping it here removes the previously-duplicated literal in finetune/evals/
 * tasks-server.
 */
export const FINETUNE_EXPERIMENT = "nqr-ft";

/**
 * Notes are stored as TL experiments' `notes/readme.md`. Each user-facing note is
 * a hidden experiment whose id carries this prefix, which keeps the notes
 * namespace separate from real job experiments (and lets job fan-outs skip them).
 */
export const NOTE_PREFIX = "note-";
