// ui/battle-ui.jsx: the battle HUD's lookup tables and the two tiny components (SkIco, AimSkills — the shared aimed-skill
// row of wizards / cannons / catapults).
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  base,
  SkIco,
  AimSkills,
  GROUP_LABEL,
  abilIcon,
  ABIL_ICO,
  UNIT_CATEGORY,
  CATEGORY_ORDER,
  descFor,
  ROLE,
  MATCHUP,
  TYPE_DESC,
} from "../ui/battle-ui.jsx";

afterEach(() => cleanup());

describe("SkIco", () => {
  it("draws the named HUD icon", () => {
    const { container } = render(<SkIco n="skill_charge" />);
    const img = container.querySelector("img");
    expect(img.getAttribute("src")).toBe("/games/reign-of-swords/hud/skill_charge.png");
    expect(base).toBe("/games/reign-of-swords/");
    expect(img.className).toBe("ros-tool-ico");
  });
});

describe("AimSkills", () => {
  const skills = [
    { id: "fireball", name: "Fireball", icon: "skill_fireball", min: 2, max: 4, desc: "Burns an area" },
    { id: "grape", name: "Grapeshot", icon: "skill_grapeshot", min: 1, max: 1, desc: "Point blank" },
    {
      id: "conjure",
      name: "Conjure",
      icon: "skill_conjure",
      min: 1,
      max: 2,
      desc: "Raise a minion",
      count: "3/3",
      disabled: true,
      countNote: "cap reached",
      countTitle: "minions",
    },
    { id: "summon", name: "Summon", icon: "skill_conjure", min: 1, max: 2, desc: "x", count: "1/3" },
  ];

  it("renders nothing without skills", () => {
    expect(render(<AimSkills skills={null} onPick={() => {}} />).container.innerHTML).toBe("");
    expect(render(<AimSkills skills={[]} onPick={() => {}} />).container.innerHTML).toBe("");
  });

  it("one button per skill: icon, name, range band; the armed one is lit", () => {
    const onPick = vi.fn();
    const { container } = render(<AimSkills skills={skills} active="fireball" onPick={onPick} base="/ep2/" />);
    expect(container.querySelector(".ros-aim-skills-label").textContent).toBe("Skills:");
    const b = container.querySelectorAll("button");
    expect(b.length).toBe(4);
    expect(b[0].className).toBe("btn-run ros-shift-btn ros-aim-skill on");
    expect(b[0].title).toBe("Burns an area");
    expect(b[0].querySelector("img").getAttribute("src")).toBe("/ep2/hud/skill_fireball.png");
    expect(b[0].querySelector(".ros-skill-rng").textContent).toBe("rng 2–4");
    expect(b[1].className).toBe("btn-run ros-shift-btn ros-aim-skill");
    expect(b[1].querySelector(".ros-skill-rng").textContent).toBe("rng 1"); // a single range
    fireEvent.click(b[1]);
    expect(onPick).toHaveBeenCalledWith("grape");
  });

  it("a capped summon is greyed out with its count and note, and can't be picked", () => {
    const onPick = vi.fn();
    const { container } = render(<AimSkills skills={skills} onPick={onPick} />);
    const capped = container.querySelectorAll("button")[2];
    expect(capped.disabled).toBe(true);
    expect(capped.className).toContain("ros-skill-maxed");
    expect(capped.querySelector("img").getAttribute("src")).toBe(base + "hud/skill_conjure.png");
    const cnt = capped.querySelector(".ros-skill-cnt");
    expect(cnt.textContent).toBe("3/3 · cap reached");
    expect(cnt.title).toBe("minions");
    fireEvent.click(capped);
    expect(onPick).not.toHaveBeenCalled();
    const open = container.querySelectorAll("button")[3].querySelector(".ros-skill-cnt");
    expect(open.textContent).toBe("1/3");
    expect(open.title).toBe("minions standing / cap");
  });

  it("a disabled skill without its own note says 'limit'", () => {
    const { container } = render(
      <AimSkills
        skills={[{ id: "a", name: "A", icon: "i", min: 1, max: 2, count: "2/2", disabled: true }]}
        onPick={() => {}}
      />,
    );
    expect(container.querySelector(".ros-skill-cnt").textContent).toBe("2/2 · limit");
  });
});

describe("lookup tables", () => {
  it("ability → icon by the name the ability line starts with", () => {
    expect(abilIcon(null)).toBeNull();
    expect(abilIcon("")).toBeNull();
    expect(abilIcon("Charge: gallop")).toBe("skill_charge");
    expect(abilIcon("Barrage (catapult)")).toBe("skill_blast");
    expect(abilIcon("Build & Repair walls")).toBe("skill_build");
    expect(abilIcon("Low Arc")).toBeNull();
    for (const [k, v] of Object.entries(ABIL_ICO)) expect(abilIcon(k)).toBe(v);
  });

  it("Siege Armor gets its own icon, not plain Siege's (the longest matching name wins)", () => {
    expect(abilIcon("Siege Armor")).toBe("skill_siegearmor");
    expect(abilIcon("Siege")).toBe("skill_siege");
  });

  it("every categorised unit falls in a listed category; group labels", () => {
    for (const cat of Object.values(UNIT_CATEGORY)) expect(CATEGORY_ORDER).toContain(cat);
    expect(GROUP_LABEL).toEqual({ story: "Campaign", siege: "Raids", skirmish: "Battlefields", special: "Tutorials" });
  });

  it("unit blurb: by type first, else by kind; every role has a label; no emoji in the texts", () => {
    for (const text of [...Object.values(MATCHUP), ...Object.values(TYPE_DESC)]) expect(text).toMatch(/^[A-Z]/);
    expect(descFor({ type: "stag", kind: "cavalry" })).toBe(TYPE_DESC.stag);
    expect(descFor({ type: "archers", kind: "ranged" })).toBe(MATCHUP.ranged);
    expect(descFor({ type: "x", kind: "y" })).toBeUndefined();
    expect(descFor(null)).toBeNull();
    for (const k of Object.keys(MATCHUP)) expect(ROLE[k]).toBeTruthy();
  });
});
