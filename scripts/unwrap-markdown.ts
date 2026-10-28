#!/usr/bin/env bun
/**
 * Remove hard line wraps from Markdown prose: one paragraph or list item per line.
 *
 * A paragraph is joined only when every line break in it is explained by wrapping at one
 * column width (the next word would not have fit). Anything else, such as a short line
 * followed by more text, is treated as an intentional break and left alone. Frontmatter,
 * fenced and indented code, tables, headings, blockquotes, HTML, link definitions, labeled
 * lines and hard breaks are never touched.
 *
 * Usage: unwrap-markdown.ts [--write | --check] [--verbose] (--tracked | <file...>)
 *
 * `--tracked` takes every tracked `*.md` file except the ones in EXCLUDED. `--check` exits 1
 * when any file would change; `--write` rewrites files in place.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** Tracked Markdown that `--tracked` leaves alone, with the reason. */
const EXCLUDED: RegExp[] = [
  /^\.agents\/skills\/(sane-[^/]+|html-ppt)\//, // vendored: fix it upstream
  /^releases\//, // store release notes: line breaks are content
  /^pipeline\/src\/shared\/templates\//, // prompt templates: whitespace is content
  /^CLAUDE\.md$/, // symlink to AGENTS.md
  /(^|\/)node_modules\//,
];

const FENCE = /^\s*(`{3,}|~{3,})/;
const COMMENT_OPEN = /^\s{0,3}<!--/;
const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const SETEXT = /^\s{0,3}(=+|-+)\s*$/;
const TABLE = /^\s*\|/;
const QUOTE = /^\s{0,3}>/;
const REFDEF = /^\s{0,3}\[[^\]]+\]:\s/;
/** A block-level tag, or a line made of a single tag. A stray `<version>` in prose is text. */
const HTML =
  /^\s{0,3}(?:<\/?(?:div|p|details|summary|table|thead|tbody|tr|td|th|ul|ol|li|pre|blockquote|section|center|img|br|hr|h[1-6])\b|<\/?[A-Za-z][^>\s]*(?:\s[^>]*)?>\s*$)/i;
const STRUCTURAL = [HEADING, HR, TABLE, QUOTE, HTML, REFDEF];
const LIST = /^(\s*)([-*+]|\d{1,9}[.)])\s+\S/;
/** A line that starts a labeled part: `**Why:**` or a short capitalized `Prevented by:`. */
const LABEL = /^\s*(?:\*\*[^*\n]{1,40}:\*\*|[A-Z][A-Za-z' ]{0,24}:\s)/;
/** A line that is only a bold title, optionally behind a list marker or an emoji and dash. */
const TITLE = /^\s*(?:(?:[-*+]|\d{1,9}[.)])\s+)?(?:\S{1,4}\s+-\s+)?\*\*[^*\n]+\*\*\s*$/;
const HARD_BREAK = /( {2,}|\\)$/;
const WHITESPACE = /\s+/;
const TRAILING_SPACE = /\s+$/;

/** A wrapped line may end this far short of the estimated wrap column. */
const SLACK = 4;
/** Below this column a paragraph is more likely short intentional lines than wrapped prose. */
const MIN_WIDTH = 60;
/** The longest line may exceed the wrap column by this much (an unbreakable span). */
const MAX_OVERSHOOT = 45;
/** A line ending at this fraction of the column still counts as wrapped. */
const NEAR_COLUMN = 0.72;

export type Skipped = { line: number; text: string };
export type Result = { output: string; joined: number; skipped: Skipped[] };
type Unit = { start: number; lines: string[] };

function firstWordLength(line: string): number {
  return (line.trim().split(WHITESPACE)[0] ?? "").length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Returns the index of the first line break that wrapping cannot explain, or -1.
 *
 * The wrap column is estimated as the median length of the lines that precede a break.
 * Greedy wrapping at width W leaves every such line within one word of W, so
 * `length + 1 + next word` always exceeds the median. A single long line (an inline code span
 * that cannot break) must not redefine the column, but a line far longer than the rest means
 * the paragraph mixes wrapped and unwrapped text: keep it.
 */
function firstUnexplainedBreak(lines: string[]): number {
  const lengths = lines.map(line => line.length);
  const column = median(lengths.slice(0, -1));
  if (column < MIN_WIDTH || Math.max(...lengths) > column + MAX_OVERSHOOT) {
    return 0;
  }
  for (let i = 0; i < lines.length - 1; i++) {
    const wouldHaveFit = lengths[i] + 1 + firstWordLength(lines[i + 1]) <= column - SLACK;
    // A hand wrap can end a line early, but not at half the column.
    if (wouldHaveFit && lengths[i] < column * NEAR_COLUMN) {
      return i;
    }
  }
  return -1;
}

/** Index of the first line after the frontmatter, whose block scalars keep their lines. */
/** A closing fence uses the same character, at least as many times, and carries no info string. */
function closesFence(line: string, opening: string): boolean {
  const match = FENCE.exec(line);
  return (
    match !== null &&
    match[1][0] === opening[0] &&
    match[1].length >= opening.length &&
    line.trim() === match[1]
  );
}

function bodyStart(lines: string[]): number {
  if (lines[0]?.trim() !== "---") {
    return 0;
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return close === -1 ? lines.length : close + 1;
}

class Reflow {
  readonly out: string[] = [];
  readonly skipped: Skipped[] = [];
  joined = 0;
  private unit: Unit | null = null;
  private fence: string | null = null;
  private inComment = false;
  private inList = false;
  private prevBlank = true;

  run(lines: string[]): void {
    const start = bodyStart(lines);
    this.out.push(...lines.slice(0, start));
    for (let i = start; i < lines.length; i++) {
      this.consume(lines[i], i);
    }
    this.flush();
  }

  private consume(line: string, index: number): void {
    if (this.fence !== null || this.inComment) {
      this.passThrough(line);
    } else if (line.trim() === "") {
      this.flush();
      this.out.push(line);
      this.prevBlank = true;
    } else if (FENCE.test(line) || COMMENT_OPEN.test(line)) {
      this.openBlock(line);
    } else {
      this.consumeBlockLine(line, index);
    }
  }

  private consumeBlockLine(line: string, index: number): void {
    const indent = line.length - line.trimStart().length;
    if (this.isVerbatim(line, indent)) {
      this.flush();
      this.out.push(line);
      if (HEADING.test(line) || indent === 0) {
        this.inList = false;
      }
      this.prevBlank = false;
    } else if (LIST.test(line)) {
      this.flush();
      this.unit = { start: index, lines: [line] };
      this.inList = true;
      this.prevBlank = false;
    } else {
      this.consumeText(line, indent, index);
    }
  }

  private passThrough(line: string): void {
    this.out.push(line);
    if (this.fence !== null && closesFence(line, this.fence)) {
      this.fence = null;
    } else if (this.inComment && line.includes("-->")) {
      this.inComment = false;
    }
    this.prevBlank = false;
  }

  private openBlock(line: string): void {
    this.flush();
    this.out.push(line);
    const fence = FENCE.exec(line);
    if (fence) {
      this.fence = fence[1];
    } else if (!line.includes("-->")) {
      this.inComment = true;
    }
    this.prevBlank = false;
  }

  private isVerbatim(line: string, indent: number): boolean {
    if (STRUCTURAL.some(pattern => pattern.test(line))) {
      return true;
    }
    if (SETEXT.test(line) && this.unit !== null) {
      return true;
    }
    return indent >= 4 && this.prevBlank && !this.inList && this.unit === null;
  }

  private consumeText(line: string, indent: number, index: number): void {
    if (indent === 0 && this.prevBlank) {
      this.inList = false;
    }
    const previous = this.unit?.lines.at(-1);
    const continues =
      previous !== undefined &&
      !HARD_BREAK.test(previous) &&
      !LABEL.test(line) &&
      !TITLE.test(previous);
    if (this.unit && continues) {
      this.unit.lines.push(line);
    } else {
      this.flush();
      this.unit = { start: index, lines: [line] };
    }
    this.prevBlank = false;
  }

  private flush(): void {
    const unit = this.unit;
    this.unit = null;
    if (!unit) {
      return;
    }
    const bad = unit.lines.length > 1 ? firstUnexplainedBreak(unit.lines) : -1;
    if (bad === -1 && unit.lines.length > 1) {
      const [first, ...rest] = unit.lines;
      this.out.push(
        [first.replace(TRAILING_SPACE, ""), ...rest.map(line => line.trim())].join(" ")
      );
      this.joined += unit.lines.length - 1;
      return;
    }
    this.out.push(...unit.lines);
    if (bad !== -1) {
      const widths = unit.lines.map(line => line.length).join(",");
      this.skipped.push({
        line: unit.start + 1,
        text: `${unit.lines[0].trim().slice(0, 70)} [break after line ${bad + 1} of ${unit.lines.length}; widths ${widths}]`,
      });
    }
  }
}

export function unwrap(source: string): Result {
  const reflow = new Reflow();
  reflow.run(source.split("\n"));
  return { output: reflow.out.join("\n"), joined: reflow.joined, skipped: reflow.skipped };
}

function trackedMarkdown(): string[] {
  const listed = Bun.spawnSync(["git", "ls-files", "*.md"]).stdout.toString().split("\n");
  return listed.filter(file => file && !EXCLUDED.some(pattern => pattern.test(file)));
}

function resolveFiles(args: string[]): string[] {
  const listArg = args.find(arg => arg.startsWith("--files-from="));
  const listed = listArg
    ? readFileSync(listArg.slice("--files-from=".length), "utf-8").split("\n").filter(Boolean)
    : [];
  return [
    ...args.filter(arg => !arg.startsWith("--")),
    ...listed,
    ...(args.includes("--tracked") ? trackedMarkdown() : []),
  ];
}

function main(): void {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const verbose = args.includes("--verbose");
  const files = resolveFiles(args);
  const say = (text: string): void => {
    process.stdout.write(`${text}\n`);
  };
  if (files.length === 0) {
    process.stderr.write("no files: pass paths or --tracked\n");
    process.exit(2);
  }

  let changed = 0;
  let totalJoined = 0;
  let totalSkipped = 0;
  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    const result = unwrap(source);
    totalSkipped += result.skipped.length;
    if (result.output !== source) {
      changed++;
      totalJoined += result.joined;
      if (write) {
        writeFileSync(file, result.output);
      }
      say(`${write ? "rewrote" : "would rewrite"} ${file} (${result.joined} line breaks)`);
    }
    if (verbose) {
      for (const kept of result.skipped) {
        say(`  kept  ${file}:${kept.line}  ${kept.text}`);
      }
    }
  }
  const verdict = write ? "rewritten" : "need reflow";
  say(
    `${changed} of ${files.length} files ${verdict}, ${totalJoined} line breaks joined, ${totalSkipped} multi-line paragraphs kept`
  );
  if (args.includes("--check") && changed > 0) {
    process.stderr.write(
      "Markdown prose is hard-wrapped. Rewrite it with --write; write each paragraph on one line.\n"
    );
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
