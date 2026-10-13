// 挿入ロジックと名前づけ。DOM にもファイルにも触れない（文字列だけを扱う）

export interface Rule {
  search: string;
  insert: string;
}

export function getIndent(line: string): string {
  return line.match(/^[ \t]*/)?.[0] ?? "";
}

/**
 * search を含む行の一行上に、同じインデントで insert を挿入する。
 * 1行が複数の組に一致したら、組の順番で全部挿入する。
 */
export function insertAbove(text: string, rules: Rule[]): { result: string; count: number } {
  // 元の改行コードを保つ（CRLF のファイルは CRLF のまま）
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];
  let count = 0;

  for (const line of text.split(/\r?\n/)) {
    for (const rule of rules) {
      if (!line.includes(rule.search)) continue;

      if (rule.insert === "") {
        // 空行にはインデントを付けない（行末に空白を残さないため）
        out.push("");
      } else {
        const indent = getIndent(line);
        for (const insertLine of rule.insert.split(/\r?\n/)) {
          out.push(indent + insertLine);
        }
      }
      count++;
    }
    out.push(line);
  }

  return { result: out.join(eol), count };
}

// "app.ts" → ["app", ".ts"]、".env" → [".env", ""]、"Makefile" → ["Makefile", ""]
function splitExt(name: string): [string, string] {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return [name, ""];
  return [name.slice(0, dot), name.slice(dot)];
}

/** "app.ts" → "app_fix.ts" */
export function fixedName(name: string): string {
  const [base, ext] = splitExt(name);
  return `${base}_fix${ext}`;
}

/** ("app.ts", 2) → "app_fix(2).ts"。n が 1 なら fixedName と同じ */
export function numberedName(name: string, n: number): string {
  if (n <= 1) return fixedName(name);
  const [base, ext] = splitExt(name);
  return `${base}_fix(${n})${ext}`;
}

/** ".ts" と "ts" のどちらでも受け付ける。大文字・小文字は無視 */
export function hasExtension(name: string, exts: string[]): boolean {
  const lower = name.toLowerCase();
  return exts.some((ext) => {
    const e = ext.toLowerCase();
    return lower.endsWith(e.startsWith(".") ? e : `.${e}`);
  });
}

/** "a, b ,c" → ["a", "b", "c"]（空の要素は捨てる） */
export function parseList(input: string): string[] {
  return input
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}
