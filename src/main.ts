import "./style.css";
import { insertAbove, parseList, type Rule } from "./logic";
import {
  collectFiles,
  isSupported,
  pickFile,
  pickFolder,
  readText,
  toPath,
  writeUnique,
  type SourceFile,
} from "./files";

// ---------- 部品の取得 ----------

// <T> で「どの種類の部品か」を指定できる（例：getEl<HTMLInputElement>("...") なら .value が使える）
function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`#${id} が見つかりません`);
  }
  return element as T;
}

const unsupported = getEl("unsupported");
const pickFileBtn = getEl<HTMLButtonElement>("pick-file-btn");
const pickFolderBtn = getEl<HTMLButtonElement>("pick-folder-btn");
const sourceName = getEl("source-name");
const folderOptions = getEl("folder-options");
const extList = getEl("ext-list");
const extCustom = getEl<HTMLInputElement>("ext-custom");
const excludeInput = getEl<HTMLInputElement>("exclude-input");
const rulesBox = getEl("rules");
const ruleTemplate = getEl<HTMLTemplateElement>("rule-template");
const addRuleBtn = getEl<HTMLButtonElement>("add-rule-btn");
const pickOutputBtn = getEl<HTMLButtonElement>("pick-output-btn");
const outputName = getEl("output-name");
const panels = {
  help: getEl("panel-help"),
  files: getEl("panel-files"),
  loading: getEl("panel-loading"),
  done: getEl("panel-done"),
};
const filesCount = getEl("files-count");
const fileList = getEl("file-list");
const doneImg = getEl<HTMLImageElement>("done-img");
const summary = getEl("summary");
const savedList = getEl("saved-list");
const message = getEl("message");
const startBtn = getEl<HTMLButtonElement>("start-btn");

// ---------- 状態 ----------

const state = {
  folder: null as FileSystemDirectoryHandle | null, // フォルダを選んだときだけ入る
  targets: [] as SourceFile[], // 処理するファイルの一覧
  output: null as FileSystemDirectoryHandle | null,
  running: false,
};

// ---------- 表示の切り替え ----------

function showPanel(name: keyof typeof panels) {
  for (const [key, panel] of Object.entries(panels)) {
    panel.hidden = key !== name;
  }
}

function updateStartButton() {
  startBtn.disabled = state.running || state.targets.length === 0 || !state.output;
}

function showMessage(text: string) {
  message.textContent = text;
}

function showTargets() {
  fileList.replaceChildren(
    ...state.targets.map((t) => {
      const li = document.createElement("li");
      li.textContent = toPath(t);
      return li;
    }),
  );
  filesCount.textContent =
    state.targets.length === 0 ? "対象のファイルがありません" : `対象ファイル：${state.targets.length} 件`;
  showPanel("files");
}

// ---------- 検索と挿入の組 ----------

function addRule() {
  const fragment = ruleTemplate.content.cloneNode(true) as DocumentFragment;
  const rule = fragment.querySelector<HTMLElement>(".rule")!;
  rule.querySelector(".rule-remove")!.addEventListener("click", () => {
    rule.remove();
    renumberRules();
  });
  rulesBox.append(rule);
  renumberRules();
}

// 「組 1」「組 2」… の番号を振り直す。最後の1組は削除できない
function renumberRules() {
  const rules = rulesBox.querySelectorAll<HTMLElement>(".rule");
  rules.forEach((rule, i) => {
    rule.querySelector(".rule-no")!.textContent = `組 ${i + 1}`;
    rule.querySelector<HTMLButtonElement>(".rule-remove")!.disabled = rules.length === 1;
  });
}

function readRules(): Rule[] {
  return [...rulesBox.querySelectorAll<HTMLElement>(".rule")].map((rule) => ({
    search: rule.querySelector<HTMLInputElement>(".rule-search")!.value,
    insert: rule.querySelector<HTMLTextAreaElement>(".rule-insert")!.value,
  }));
}

// ---------- 入力の選択 ----------

function selectedExts(): string[] {
  const checked = [...extList.querySelectorAll<HTMLInputElement>("input:checked")].map((c) => c.value);
  return [...checked, ...parseList(extCustom.value)];
}

async function rescanFolder() {
  if (!state.folder) return;
  state.targets = await collectFiles(state.folder, selectedExts(), parseList(excludeInput.value));
  sourceName.textContent = `${state.folder.name}/（${state.targets.length} 件）`;
  showTargets();
  updateStartButton();
}

pickFileBtn.addEventListener("click", async () => {
  const handle = await pickFile();
  if (!handle) return; // キャンセル

  showMessage("");
  if ((await readText(handle)) === null) {
    showMessage("対象ファイルを選択してください");
    return;
  }

  state.folder = null;
  state.targets = [{ dirs: [], handle }];
  folderOptions.hidden = true;
  sourceName.textContent = handle.name;
  showTargets();
  updateStartButton();
});

pickFolderBtn.addEventListener("click", async () => {
  const handle = await pickFolder("read");
  if (!handle) return; // キャンセル

  showMessage("");
  state.folder = handle;
  folderOptions.hidden = false;
  await rescanFolder();
});

// 拡張子や除外フォルダを変えたら、一覧を作り直す
extList.addEventListener("change", rescanFolder);
extCustom.addEventListener("change", rescanFolder);
excludeInput.addEventListener("change", rescanFolder);

pickOutputBtn.addEventListener("click", async () => {
  const handle = await pickFolder("readwrite");
  if (!handle) return; // キャンセル

  state.output = handle;
  outputName.textContent = `${handle.name}/`;
  updateStartButton();
});

addRuleBtn.addEventListener("click", addRule);

// ---------- 挿入開始 ----------

interface Saved {
  path: string;
  count: number;
}

async function processAll(rules: Rule[], output: FileSystemDirectoryHandle) {
  const saved: Saved[] = [];
  let skipped = 0;
  let noMatch = 0;

  for (const target of state.targets) {
    const text = await readText(target.handle);
    if (text === null) {
      skipped++; // バイナリなど読めないファイル
      continue;
    }

    const { result, count } = insertAbove(text, rules);
    if (count === 0) {
      noMatch++; // 一致なしは保存しない
      continue;
    }

    const path = await writeUnique(output, target.dirs, target.handle.name, result);
    saved.push({ path, count });
  }

  return { saved, skipped, noMatch };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showDone(saved: Saved[], skipped: number, noMatch: number) {
  const notes = [`${saved.length} 件を保存しました`];
  if (noMatch > 0) notes.push(`一致なし ${noMatch} 件`);
  if (skipped > 0) notes.push(`${skipped} 件スキップ`);
  summary.textContent = notes.join("・");

  savedList.replaceChildren(
    ...saved.map(({ path, count }) => {
      const li = document.createElement("li");
      li.className = "flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2";
      const name = document.createElement("span");
      name.className = "truncate font-mono";
      name.textContent = path;
      const badge = document.createElement("span");
      badge.className = "shrink-0 rounded-full bg-chitose-light px-2 py-0.5 font-medium text-chitose";
      badge.textContent = `${count} 箇所`;
      li.append(name, badge);
      return li;
    }),
  );

  // src を付け直すと、完了アニメーションが毎回最初から再生される
  doneImg.src = `/done.svg?t=${Date.now()}`;
  showPanel("done");
}

startBtn.addEventListener("click", async () => {
  const rules = readRules();
  if (rules.some((r) => r.search === "")) {
    showMessage("検索文字列を入力してください");
    return;
  }
  if (!state.output) return;

  showMessage("");
  state.running = true;
  updateStartButton();
  showPanel("loading");

  try {
    // 処理が一瞬で終わっても、ローディングを最低 0.8 秒は見せる
    const [{ saved, skipped, noMatch }] = await Promise.all([processAll(rules, state.output), sleep(800)]);
    showDone(saved, skipped, noMatch);
    if (saved.length === 0) {
      showMessage("見つかりませんでした");
    }
  } catch (e) {
    showPanel("files");
    showMessage(`エラーが発生しました：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    state.running = false;
    updateStartButton();
  }
});

// ---------- 起動時 ----------

addRule();

if (!isSupported()) {
  unsupported.hidden = false;
  for (const btn of [pickFileBtn, pickFolderBtn, pickOutputBtn, addRuleBtn, startBtn]) {
    btn.disabled = true;
  }
}
