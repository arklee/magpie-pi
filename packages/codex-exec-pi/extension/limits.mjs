export const DEFAULT_EXEC_YIELD_MS = 30_000;
export const DEFAULT_WAIT_YIELD_MS = 10_000;
export const MIN_ADAPTIVE_WAIT_MS = 5_000;
export const MAX_YIELD_MS = 1_800_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
export const MAX_OUTPUT_TOKENS = 100_000;
/** Characters per token used to turn token budgets into character budgets. */
export const CHARS_PER_TOKEN = 4;
export const MAX_IMAGES_PER_RESULT = 8;
/** Output buffered for one cell between observations (text and base64 image data). */
export const MAX_BUFFERED_OUTPUT_CHARS = 16 * 1024 * 1024;
/** JSON size of one tool result delivered into a cell. */
export const MAX_TOOL_RESULT_CHARS = 32 * 1024 * 1024;
export const MAX_LIVE_CELLS = 8;
export const MAX_REMEMBERED_CELLS = 64;
export const DEFAULT_HEAP_MIB = 256;
export const STORE_VALUE_MAX_CHARS = 262_144;
export const STORE_TOTAL_MAX_CHARS = 1_048_576;
