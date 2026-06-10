/**
 * Shell-like tokenizer for the TUI command bar, so `setup github -e "a b@c.com"`
 * parses identically to real argv. Supports double/single quotes and backslash
 * escapes outside single quotes. No expansion of any kind.
 */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let hasToken = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const ch of line) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      hasToken = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      continue;
    }
    current += ch;
    hasToken = true;
  }

  if (escaped) current += "\\";
  if (hasToken) tokens.push(current);
  return tokens;
}
