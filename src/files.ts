// File System Access API の操作（選ぶ・集める・読む・書く）。画面には触れない

import { hasExtension, numberedName } from "./logic";

export interface SourceFile {
  dirs: string[]; // 選んだフォルダからの階層（例：["src", "utils"]）
  handle: FileSystemFileHandle;
}

/** Chrome / Edge のように、ファイルとフォルダのダイアログが使えるか */
export function isSupported(): boolean {
  return "showOpenFilePicker" in window && "showDirectoryPicker" in window;
}

// ダイアログでキャンセルすると AbortError が投げられる
function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** ファイルを1つ選ぶ。キャンセルなら null */
export async function pickFile(): Promise<FileSystemFileHandle | null> {
  try {
    const [handle] = await window.showOpenFilePicker();
    return handle;
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

/** フォルダを選ぶ。出力先は mode を "readwrite" にする。キャンセルなら null */
export async function pickFolder(mode: "read" | "readwrite"): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode });
  } catch (e) {
    if (isAbort(e)) return null;
    throw e;
  }
}

/**
 * フォルダの中をサブフォルダまでたどり、対象の拡張子のファイルを集める。
 * excludes に一致する名前のフォルダには入らない。.class は常に除外。
 */
export async function collectFiles(
  dir: FileSystemDirectoryHandle,
  exts: string[],
  excludes: string[],
  dirs: string[] = [],
): Promise<SourceFile[]> {
  const found: SourceFile[] = [];

  for await (const entry of dir.values()) {
    if (entry.kind === "directory") {
      if (excludes.includes(entry.name)) continue;
      found.push(...(await collectFiles(entry, exts, excludes, [...dirs, entry.name])));
    } else if (hasExtension(entry.name, exts) && !hasExtension(entry.name, [".class"])) {
      found.push({ dirs, handle: entry });
    }
  }

  // 表示が毎回同じ順番になるように、パスで並べる
  return found.sort((a, b) => toPath(a).localeCompare(toPath(b)));
}

/** "src/utils/a.ts" の形にする */
export function toPath(file: SourceFile): string {
  return [...file.dirs, file.handle.name].join("/");
}

/** 中身を文字列で読む。先頭 8KB に NUL バイトがあればバイナリとみなして null */
export async function readText(handle: FileSystemFileHandle): Promise<string | null> {
  const file = await handle.getFile();
  const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  if (head.includes(0)) return null;
  return await file.text();
}

// 同じ名前のファイル（またはフォルダ）がすでにあるか
async function exists(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") return false;
    return true; // 同名のフォルダがある場合など。使えない名前として扱う
  }
}

/**
 * 出力先に dirs の階層を作り、"元の名前_fix.拡張子" で書き込む。
 * 同名があれば _fix(2)、_fix(3) … と番号を付ける。保存した相対パスを返す。
 */
export async function writeUnique(
  outDir: FileSystemDirectoryHandle,
  dirs: string[],
  name: string,
  content: string,
): Promise<string> {
  let target = outDir;
  for (const d of dirs) {
    target = await target.getDirectoryHandle(d, { create: true });
  }

  let n = 1;
  while (await exists(target, numberedName(name, n))) n++;
  const savedName = numberedName(name, n);

  const handle = await target.getFileHandle(savedName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();

  return [...dirs, savedName].join("/");
}
