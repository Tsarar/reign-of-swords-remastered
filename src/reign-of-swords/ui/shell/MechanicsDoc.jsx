import { useState, useEffect } from "react";
import { base } from "../../data/shell-data.js";

// ---- Mechanics & decompilation reference (MECHANICS.md, rendered inline) ----
// A deliberately small Markdown reader for our own document: "## " chapters (collapsible), "### " sub-heads,
// "- " bullets with two-space continuation lines, paragraphs, `code` and **bold**. No third-party renderer.
function mdInline(text) {
  const out = [];
  let i = 0,
    k = 0;
  const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let match;
  while ((match = TOKEN.exec(text))) {
    if (match.index > i) out.push(text.slice(i, match.index));
    const token = match[0];
    out.push(
      token.startsWith("`") ? <code key={k++}>{token.slice(1, -1)}</code> : <b key={k++}>{token.slice(2, -2)}</b>,
    );
    i = match.index + token.length;
  }
  if (i < text.length) out.push(text.slice(i));
  return out;
}

export function parseMdChapters(text) {
  const chapters = [];
  let cur = null,
    block = null;
  const flush = () => {
    if (block && cur) cur.blocks.push(block);
    block = null;
  };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("# ")) continue; // the page has its own title
    if (line.startsWith("## ")) {
      flush();
      cur = { title: line.slice(3), blocks: [] };
      chapters.push(cur);
      continue;
    }
    if (!cur) continue; // intro text before the first chapter is skipped
    if (line.startsWith("### ")) {
      flush();
      cur.blocks.push({ h: line.slice(4) });
      continue;
    }
    if (line.startsWith("- ")) {
      flush();
      block = { li: [line.slice(2)] };
      continue;
    }
    const numbered = /^(\d+)\. (.*)$/.exec(line);
    if (numbered) {
      if (block && block.ol) block.ol.push(numbered[2]);
      else {
        flush();
        block = { ol: [numbered[2]] };
      }
      continue;
    }
    if (line.startsWith("  ") && block && (block.li || block.ol)) {
      const a = block.li || block.ol;
      a[a.length - 1] += " " + line.trim();
      continue;
    }
    if (line === "") {
      flush();
      continue;
    }
    if (block && block.p != null) block.p += " " + line.trim();
    else {
      flush();
      block = { p: line.trim() };
    }
  }
  flush();
  // merge consecutive bullet blocks into one list
  for (const chapter of chapters) {
    const merged = [];
    for (const b of chapter.blocks) {
      const last = merged[merged.length - 1];
      if (b.li && last && last.li) last.li.push(...b.li);
      else if (b.ol && last && last.ol) last.ol.push(...b.ol);
      else merged.push(b.li ? { li: [...b.li] } : b.ol ? { ol: [...b.ol] } : b);
    }
    chapter.blocks = merged;
  }
  return chapters;
}

export function MechanicsDoc({ dbase = base }) {
  const [text, setMd] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    fetch(dbase + "MECHANICS.md")
      .then((r) => r.text())
      .then(setMd)
      .catch(() => setMd(""));
  }, [dbase]);
  if (text == null) return <p className="ros-screen-sub">Loading the mechanics reference…</p>;
  const chapters = parseMdChapters(text);
  if (!chapters.length) return null;
  return (
    <div className="ros-mech">
      <p className="ros-screen-sub">
        Every rule the recreation runs on — units, combat, abilities, maps and scripts, turn order and heraldry, the
        group AI, economy, sounds, animations — each with the{" "}
        <b>decompiled function, resource or string it was read from</b> (iOS binaries <code>ros_ep1</code> /{" "}
        <code>ros_ep2</code>, the <code>.dat</code>
        archive), and an honest split of what is data and what is ours. Also in the download as{" "}
        <code>MECHANICS.md</code>.
      </p>
      {chapters.map((c, i) => (
        <div key={i} className="ros-flow-kingdom ros-mech-ch">
          <button className="ros-flow-khead" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span className="ros-flow-knum">§</span>
            <b>{mdInline(c.title)}</b>
            <i>{c.blocks.reduce((n, b) => n + (b.li ? b.li.length : b.ol ? b.ol.length : 1), 0)} entries</i>
            <span className="ros-flow-caret">{open === i ? "▾" : "▸"}</span>
          </button>
          {open === i && (
            <div className="ros-flow-body ros-mech-body">
              {c.blocks.map((b, j) =>
                b.h ? (
                  <h4 key={j}>{mdInline(b.h)}</h4>
                ) : b.li ? (
                  <ul key={j}>
                    {b.li.map((t, k) => (
                      <li key={k}>{mdInline(t)}</li>
                    ))}
                  </ul>
                ) : b.ol ? (
                  <ol key={j}>
                    {b.ol.map((t, k) => (
                      <li key={k}>{mdInline(t)}</li>
                    ))}
                  </ol>
                ) : (
                  <p key={j}>{mdInline(b.p)}</p>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
