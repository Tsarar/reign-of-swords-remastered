// About — the original game's credits (tools/ros/credits.py → credits.json; ui/shell/Credits.jsx), and the main menu
// entry that opens it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import Credits from "../ui/shell/Credits.jsx";
import MainMenu from "../ui/shell/MainMenu.jsx";

const load = (dir) => JSON.parse(readFileSync(`public/games/${dir}/credits.json`, "utf-8"));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the original credits (credits.json)", () => {
  it("Episode I and Episode II list their own teams, as their About screens do", () => {
    const ep1 = load("reign-of-swords"),
      ep2 = load("reign-of-swords-2");
    expect(ep1.copyright).toBe("(c) 2008 Punch Entertainment.");
    expect(ep2.copyright).toBe("(c) 2009 Punch Entertainment.");
    const section = (d, title) => d.sections.find((s) => s.title === title).names;
    expect(section(ep1, "Creative Director")).toEqual(["Steve Nix"]);
    expect(section(ep1, "Lead Artist")).toEqual(["Forrest Schehl"]);
    expect(section(ep2, "Original Game Design")).toEqual(["Steve Nix"]);
    expect(section(ep2, "Engineers")).toContain("Christopher Dabney");
    expect(section(ep2, "Game Audio")).toEqual(["Clean Cuts Music and Sound Design"]);
    // no stray menu text pulled in past the credits
    for (const d of [ep1, ep2]) for (const s of d.sections) expect(s.names.join(" ")).not.toMatch(/maximum|Main Menu/);
  });

  it("Episode I also lists its other builds: the Android 1.2.9 team and the three PC-only names — 52 people in all", () => {
    const ep1 = load("reign-of-swords"),
      ep2 = load("reign-of-swords-2");
    const [android, pc] = ep1.otherBuilds;
    expect(android.build).toBe("Android");
    expect(android.version).toBe("v1.2.9");
    expect(android.sections.map((s) => s.title)).toEqual([
      "Creative Director",
      "Engineers",
      "Artists",
      "QA",
      "Special Thanks",
    ]);
    expect(android.sections[3].names).toContain("Ram Fenster");
    // the paywall strings right after the credits stay out
    expect(android.sections.flatMap((s) => s.names).join(" ")).not.toMatch(/Buy Now|Enter Code/);
    expect(pc.build).toBe("PC");
    expect(pc.sections[0].names).toEqual(["Brent Patterson", "Cuong Nguyen", "Nhung Ngo"]);
    const people = new Set(
      [ep1, ep2]
        .flatMap((d) => [...d.sections, ...(d.otherBuilds || []).flatMap((b) => b.sections)])
        .flatMap((s) => s.names),
    );
    people.delete("Clean Cuts Music and Sound Design");
    expect(people.size).toBe(52);
  });
});

describe("About", () => {
  it("the main menu's About opens the credits; Close closes them", async () => {
    const onAbout = vi.fn();
    render(<MainMenu dataBase="/x/" menuBg="" onAbout={onAbout} />);
    fireEvent.click(screen.getByRole("button", { name: "About" }));
    expect(onAbout).toHaveBeenCalled();
    cleanup();
    vi.stubGlobal("fetch", () => Promise.resolve({ json: () => Promise.resolve(load("reign-of-swords")) }));
    const onClose = vi.fn();
    render(<Credits dataBase="/games/reign-of-swords/" onClose={onClose} />);
    await waitFor(() => expect(screen.getAllByText("Steve Nix").length).toBe(3)); // iPhone: director + designer; Android: director
    expect(screen.getAllByText("Creative Director").length).toBe(2);
    expect(screen.getByText(/2008 Punch Entertainment/)).toBeTruthy();
    expect(screen.getByText("Android version")).toBeTruthy();
    expect(screen.getByText("Nhung Ngo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
