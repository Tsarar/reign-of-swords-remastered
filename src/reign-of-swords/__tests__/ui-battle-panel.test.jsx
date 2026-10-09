// The battle screen's lower panel (ui/ReignOfSwords.jsx): the deployment muster (points, elite medals, roster by
// category, Fight), the control row (End Turn / Undo / Hold / Next / Formation / Fast / Restart / Quit, Cancel aim)
// and the unit card — a selected unit (stats, kit, statuses, the charge banner, abilities, shapeshift, aimed skills,
// prayers, formation), an inspected unit, a terrain tile, and the empty-card prompts. The engine is mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { mountReign } from "../engine/engine.js";
import ReignOfSwords from "../ui/ReignOfSwords.jsx";
import { mountBattle, mission } from "./ui-helpers.js";

vi.mock("../engine/engine.js", async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, mountReign: vi.fn() };
});

const BASE = "/games/reign-of-swords/";
const mount = (props, o) => mountBattle(mountReign, ReignOfSwords, props, o);
const btn = (name) => screen.getByRole("button", { name });
const qBtn = (name) => screen.queryByRole("button", { name });
// the kit row's words (the sword / shield icons carry no text)
const kitText = (c) => c.querySelector(".ros-uc-kit").textContent.replace(/\s+/g, " ").trim();
const uc = (c) => c.querySelector(".ros-unitcard");

beforeEach(() => {
  mountReign.mockReset();
});
afterEach(() => cleanup());

describe("deployment muster", () => {
  const roster = [
    { type: "militiamen", name: "Militiamen", cost: 50, affordable: true },
    { type: "archers", name: "Archers", cost: 100, affordable: false, left: 2 },
    { type: "cavalry", name: "Cavalry", cost: 200, affordable: true },
    { type: "raiders", name: "Raiders", cost: 150, affordable: true },
    { type: "knights", name: "Knights", cost: 400, affordable: true, elite: true },
    { type: "mysteryman", name: "Mystery Man", cost: 10, affordable: true }, // uncategorised → Infantry
  ];
  const dep = (over = {}) => ({ budget: 1000, spent: 250, placed: 0, eliteMax: 1, eliteUsed: 0, roster, ...over });

  it("shows points left, elite medals left and the roster grouped by role (cavalry cheap → heavy)", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ phase: "deploy", deploy: dep({ placing: "archers" }), mission: mission() });
    expect(container.querySelector(".ros-deploy-points").textContent).toBe("Points 750 / 1000");
    expect(container.querySelector(".ros-deploy-medals").textContent).toBe("1 / 1 left");
    const groups = [...container.querySelectorAll(".ros-rost-group")].map((g) => [
      g.querySelector(".ros-rost-cat").textContent,
      [...g.querySelectorAll(".ros-rost-name")].map((n) => n.textContent),
    ]);
    expect(groups).toEqual([
      ["Levy", ["Militiamen"]],
      ["Infantry", ["Mystery Man"]],
      ["Missile", ["Archers ×2"]],
      ["Cavalry", ["Knights", "Raiders", "Cavalry"]], // the roster's order, reversed
    ]);
    const archers = [...container.querySelectorAll(".ros-rost")].find((b) => b.textContent.includes("Archers"));
    expect(archers.className).toBe("ros-rost sel off");
    expect(archers.querySelector(".ros-rost-cost").textContent).toBe("100");
    expect(archers.querySelector(".ros-rost-icon").getAttribute("src")).toBe(BASE + "sprites/stand/archers.png");
    const knights = [...container.querySelectorAll(".ros-rost")].find((b) => b.textContent.includes("Knights"));
    expect(knights.querySelector(".ros-rost-elite")).toBeTruthy();
    expect(container.querySelector(".ros-deploy-goal").textContent).toBe("🎯 Goal: Destroy the enemy army.");
  });

  it("a map fought before offers its last setup at the muster; Fight keeps the new one", async () => {
    const kept = { units: [{ type: "militiamen", tx: 3, ty: 4, face: 1 }], hero: null };
    localStorage.setItem("ros-setup-v1", JSON.stringify({ 200: kept }));
    const { push, ctrl } = await mount({ campaignMapId: 200 });
    ctrl.game = { applySetup: vi.fn(), deploySetup: vi.fn(() => ({ units: [{ type: "archers", tx: 1, ty: 1 }] })) };
    push({ phase: "deploy", deploy: dep({ placed: 1, spent: 950 }), mission: mission() });
    expect(screen.getByText("Previous Setup Found")).toBeTruthy();
    fireEvent.click(btn("Yes"));
    expect(ctrl.game.applySetup).toHaveBeenCalledWith(kept);
    expect(screen.queryByText("Previous Setup Found")).toBeNull();
    fireEvent.click(btn(/Fight/));
    expect(ctrl.startBattle).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem("ros-setup-v1"))[200].units[0].type).toBe("archers");
  });

  it("the question comes first: the muster's opening waits for the answer, and a line already up goes before it", async () => {
    const kept = { units: [{ type: "militiamen", tx: 3, ty: 4, face: 1 }], hero: null };
    localStorage.setItem("ros-setup-v1", JSON.stringify({ 200: kept }));
    const { push, ctrl } = await mount({ campaignMapId: 200 });
    ctrl.game = { applySetup: vi.fn(), deploySetup: vi.fn(() => ({ units: [] })) };
    // the engine is told, before it opens the battle, which musters will ask
    const hold = ctrl.setMusterHold.mock.calls[0][0];
    expect(ctrl.setMusterHold.mock.invocationCallOrder[0]).toBeLessThan(ctrl.openBattle.mock.invocationCallOrder[0]);
    expect([hold(200), hold(201), hold(null)]).toEqual([true, false, false]);
    // held opening: the question alone, no line behind it; No → the opening plays
    push({ phase: "deploy", deploy: dep(), mission: mission(), musterHeld: true });
    expect(screen.getByText("Previous Setup Found")).toBeTruthy();
    expect(document.querySelector(".ros-event-cut")).toBeNull();
    expect(ctrl.releaseMuster).not.toHaveBeenCalled();
    fireEvent.click(btn("No"));
    expect(ctrl.game.applySetup).not.toHaveBeenCalled();
    expect(ctrl.releaseMuster).toHaveBeenCalledTimes(1);
    cleanup();
    // a line that arrives WITH the muster (the drill's greeting): read first, then the question
    const again = await mount({ campaignMapId: 200 });
    again.ctrl.game = { applySetup: vi.fn(), deploySetup: vi.fn(() => ({ units: [] })) };
    const line = { lines: [{ speaker: "Sir Roderick", text: "Wake up, squire." }], id: 1 };
    again.push({ phase: "deploy", deploy: dep(), mission: mission(), battleEvent: line });
    expect(screen.queryByText("Previous Setup Found")).toBeNull();
    expect(screen.getByText("Wake up, squire.")).toBeTruthy();
    fireEvent.click(document.querySelector(".ros-event-cut"));
    expect(again.ctrl.eventClosed).toHaveBeenCalled();
    again.push({ phase: "deploy", deploy: dep(), mission: mission(), battleEvent: null });
    expect(screen.getByText("Previous Setup Found")).toBeTruthy();
    // nothing held: answering has nothing to release
    fireEvent.click(btn("Yes"));
    expect(again.ctrl.game.applySetup).toHaveBeenCalledWith(kept);
    expect(again.ctrl.releaseMuster).not.toHaveBeenCalled();
  });

  it("no setup kept: a held muster opening is released at once", async () => {
    const { push, ctrl } = await mount({ campaignMapId: 200 });
    push({ phase: "deploy", deploy: dep(), mission: mission(), musterHeld: true });
    expect(screen.queryByText("Previous Setup Found")).toBeNull();
    expect(ctrl.releaseMuster).toHaveBeenCalledTimes(1);
  });

  it("picking a roster card sets what the next tap places; Fight needs a unit on the field", async () => {
    const { push, ctrl } = await mount({ campaignMapId: 200 });
    push({ phase: "deploy", deploy: dep() });
    fireEvent.click(btn(/Militiamen/));
    expect(ctrl.setPlacing).toHaveBeenCalledWith("militiamen");
    expect(btn(/Fight/).disabled).toBe(true);
    push({ phase: "deploy", deploy: dep({ placed: 3, eliteUsed: 3 }) });
    expect(document.querySelector(".ros-deploy-medals b").textContent).toBe("0"); // never negative
    // 750 points left: the original asks first (GameScreen::onSendRaidClicked) — No goes back, Yes fights
    fireEvent.click(btn(/Fight/));
    expect(screen.getByText(/You have not fully utilized your deployment points/)).toBeTruthy();
    fireEvent.click(btn("No"));
    expect(ctrl.startBattle).not.toHaveBeenCalled();
    fireEvent.click(btn(/Fight/));
    fireEvent.click(btn("Yes"));
    expect(ctrl.startBattle).toHaveBeenCalledTimes(1);
    // under 100 left: straight in
    push({ phase: "deploy", deploy: dep({ placed: 3, spent: 950 }) });
    fireEvent.click(btn(/Fight/));
    expect(ctrl.startBattle).toHaveBeenCalledTimes(2);
  });

  it("no elite allowance, no medal counter; the regular deployment hint shows the elite cap", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ phase: "deploy", deploy: dep({ eliteMax: 0 }), mission: mission({ objectiveText: "" }) });
    expect(container.querySelector(".ros-deploy-medals")).toBeNull();
    expect(container.querySelector(".ros-deploy-goal")).toBeNull();
    const hint = container.querySelector("p.ros-hint");
    expect(hint.textContent).toContain("Deployment.");
    expect(hint.textContent).toContain("Elite: max 0.");
    expect(container.querySelector(".ros-controls")).toBeNull(); // the battle controls replace the muster later
  });

  it("before the engine sends the muster: 0 points, Fight disabled, elite cap 1", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ phase: "deploy" });
    expect(container.querySelector(".ros-deploy-points").textContent).toBe("Points 0 / 0");
    expect(btn(/Fight/).disabled).toBe(true);
    expect(container.querySelector(".ros-roster").children.length).toBe(0);
    expect(container.querySelector("p.ros-hint").textContent).toContain("Elite: max 1.");
    fireEvent.click(btn(/Fight/)); // disabled: nothing
  });

  it("a tutorial map shows the Captain's drill tips instead", async () => {
    const { push, container } = await mount({ campaignMapId: 300 });
    push({ phase: "deploy", deploy: dep(), mission: mission({ group: "special" }) });
    const tips = container.querySelector(".ros-tut-tips");
    expect(tips.textContent).toContain("Captain's drill — deployment.");
    expect(tips.querySelectorAll("li").length).toBe(4);
  });
});

describe("control row", () => {
  it("Undo / Hold follow the engine's flags and call it", async () => {
    const { push, ctrl } = await mount({ campaignMapId: 200 });
    expect(btn(/Undo/).disabled).toBe(true);
    expect(btn(/Hold/).disabled).toBe(true);
    push({ canUndo: true, canHold: true });
    fireEvent.click(btn(/Undo/));
    fireEvent.click(btn(/Hold/));
    expect(ctrl.undoMove).toHaveBeenCalledTimes(1);
    expect(ctrl.holdUnit).toHaveBeenCalledTimes(1);
  });

  it("Next jumps to an unspent unit — only on your turn with one left", async () => {
    const { push, ctrl } = await mount({ campaignMapId: 200 });
    push({ phase: "player", unmoved: 0 });
    expect(btn(/^Next$/).disabled).toBe(true);
    push({ phase: "enemy", unmoved: 2 });
    expect(btn(/^Next$/).disabled).toBe(true);
    push({ phase: "player", unmoved: 2 });
    fireEvent.click(btn(/^Next$/));
    expect(ctrl.nextUnit).toHaveBeenCalledTimes(1);
  });

  it("Formation order: disabled without an order, 'Pick spot…' while choosing the destination", async () => {
    const { push, ctrl } = await mount({ campaignMapId: 200 });
    expect(btn(/Formation/).disabled).toBe(true);
    push({ canOrder: true });
    fireEvent.click(btn(/⚑ Formation/));
    expect(ctrl.beginMarch).toHaveBeenCalledTimes(1);
    push({ canOrder: false, orderMode: "march" });
    const b = btn(/Pick spot…/);
    expect(b.disabled).toBe(false); // tap again to cancel
    expect(b.className).toContain(" on");
  });

  it("Cancel aim floats over the field while aiming", async () => {
    const { push, ctrl } = await mount({ campaignMapId: 200 });
    expect(qBtn(/Cancel aim/)).toBeNull();
    push({ aimMode: true });
    fireEvent.click(btn(/Cancel aim/));
    expect(ctrl.cancelAim).toHaveBeenCalledTimes(1);
  });

  it("Restart: a skirmish goes back to its briefing, a campaign battle reopens at once", async () => {
    const s = await mount();
    s.push({ mission: mission() });
    fireEvent.click(btn(/March/));
    fireEvent.click(btn(/Restart/));
    expect(s.ctrl.reset).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".ros-briefing")).toBeTruthy();
    cleanup();
    const c = await mount({ campaignMapId: 200 });
    c.ctrl.openBattle.mockClear();
    fireEvent.click(btn(/Restart/));
    expect(c.ctrl.reset).toHaveBeenCalledTimes(1);
    expect(c.ctrl.openBattle).toHaveBeenCalledTimes(1);
  });

  it("Quit appears with an exit handler and leaves the battle", async () => {
    await mount({ campaignMapId: 200 });
    expect(qBtn(/Quit/)).toBeNull();
    cleanup();
    const onExit = vi.fn();
    await mount({ campaignMapId: 200, onExit });
    fireEvent.click(btn(/Quit/));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("the footer explains the rules", async () => {
    const { container } = await mount({ campaignMapId: 200 });
    expect(container.querySelector(".ros-hint-foot").textContent).toContain("Turn-based tactics.");
  });
});

describe("unit card: selected unit", () => {
  const knight = (over = {}) => ({
    type: "knights",
    name: "Knights",
    kind: "cavalry",
    hp: 80,
    move: 8,
    atk: 45,
    range: 1,
    minRange: 1,
    weapon: "Lance",
    armour: "Heavy",
    ...over,
  });

  it("head, stats, kit and skill chips", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ selected: knight({ hero: true }) });
    const c = uc(container);
    expect(c.className).toBe("ros-unitcard");
    expect(c.querySelector(".ros-uc-icon").textContent).toBe(""); // the knight's own sprite (a strip), no emoji
    expect(c.querySelector(".ros-uc-icon .ros-unit-sprite, .ros-uc-icon img")).toBeTruthy();
    expect(c.querySelector(".ros-uc-name").textContent).toBe("Knights ★");
    expect(c.querySelector(".ros-uc-role").textContent).toBe("Cavalry");
    expect(c.querySelector(".ros-uc-role").className).toContain("role-cavalry");
    expect([...c.querySelectorAll(".ros-uc-stat")].map((x) => x.textContent)).toEqual([
      "HP80",
      "MOV8",
      "ATK45",
      "RNG1",
    ]);
    expect(c.querySelector(".ros-hpbar i").style.width).toBe("80%");
    expect(kitText(c)).toBe("Lance Heavy");
    expect(c.querySelector(".ros-chips")).toBeTruthy(); // the camp card's skill-chip row
  });

  it("a ranged unit's weapon shows its range band; no ATK when the engine has none; unknown kind shown raw", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({
      selected: { type: "x", name: "Odd", kind: "odd", hp: 50, move: 3, range: 5, minRange: 2, weapon: "Bow" },
    });
    const c = uc(container);
    expect(c.querySelector(".ros-uc-icon").children.length).toBe(0); // an unknown type: no sprite, no emoji
    expect(c.querySelector(".ros-uc-role").textContent).toBe("odd");
    expect(kitText(c)).toBe("Bow (rng 2–5)");
    expect(c.textContent).not.toContain("ATK");
    push({ selected: { type: "x", name: "Odd", kind: "odd", hp: 50, move: 3, range: 1, armour: "Light" } });
    expect(kitText(uc(container))).toBe("Light");
    push({ selected: { type: "x", name: "Odd", kind: "odd", hp: 50, move: 3, range: 1 } });
    expect(uc(container).querySelector(".ros-uc-kit")).toBeNull();
  });

  it("status effects with their icon and description", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({
      selected: knight({
        statuses: [
          { name: "Shielded", desc: "Takes half ranged damage for {n} turns", vars: { n: 2 }, icon: "status_shield" },
        ],
      }),
    });
    const row = uc(container).querySelector(".ros-uc-status-row");
    expect(row.textContent).toBe("Shielded — Takes half ranged damage for 2 turns");
    expect(row.querySelector("img").getAttribute("src")).toBe(BASE + "hud/status_shield.png");
    push({ selected: knight({ statuses: [] }) });
    expect(uc(container).querySelector(".ros-uc-status")).toBeNull();
  });

  it("the charge banner: ready / short (with the movement) / idle", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ selected: knight({ charge: "ready" }) });
    let ch = uc(container).querySelector(".ros-charge");
    expect(ch.className).toBe("ros-charge on");
    expect(ch.textContent).toContain("CHARGE READY — strike the foe ahead: +30, no counter-attack");
    expect(ch.querySelector("img").getAttribute("src")).toBe(BASE + "hud/skill_charge.png");
    push({ selected: knight({ charge: "short", chargeMove: 8 }) });
    ch = uc(container).querySelector(".ros-charge");
    expect(ch.className).toBe("ros-charge ");
    expect(ch.textContent).toContain("No charge — the gallop used up the movement");
    expect(ch.textContent).toContain("within its 8 movement");
    push({ selected: knight({ charge: "idle" }) });
    expect(uc(container).querySelector(".ros-charge").textContent).toContain(
      "Charge: gallop 2+ tiles in a straight line",
    );
  });

  it("an ability line: with its skill icon, or ✦ for one without", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ selected: knight({ ability: "Fire Arrows — burns structures" }) });
    let ch = uc(container).querySelector(".ros-charge");
    expect(ch.textContent).toContain("Fire Arrows — burns structures");
    expect(ch.querySelector("img").getAttribute("src")).toBe(BASE + "hud/skill_firearrows.png");
    push({ selected: knight({ ability: "Low Arc" }) });
    ch = uc(container).querySelector(".ros-charge");
    expect(ch.textContent).toBe("✦ Low Arc");
  });

  it("no charge / ability: the unit's matchup blurb, or nothing for an unknown kind", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ selected: knight({ type: "bear", kind: "cavalry" }) });
    expect(uc(container).querySelector(".ros-charge").textContent).toContain("A mighty beast");
    // the header shows the unit's own standing sprite (the game's art), not an emoji
    expect(uc(container).querySelector(".ros-uc-icon img").getAttribute("src")).toContain("sprites/stand/bear.png");
    push({ selected: knight({ type: "pikemen", kind: "spear" }) });
    expect(uc(container).querySelector(".ros-charge").textContent).toContain("Pike Wall braces");
    push({ selected: { type: "zz", name: "Z", kind: "zz", hp: 1, move: 1, range: 1 } });
    expect(uc(container).querySelector(".ros-charge")).toBeNull();
  });

  it("every weapon slot with its own reach, and each description (the original's View Unit)", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({
      selected: knight({
        type: "archers",
        kind: "ranged",
        weapons: [
          { name: "Longbow", desc: "A Longbow shoots far.", min: 2, max: 6 },
          { name: "Short Sword", desc: "A last resort.", min: 1, max: 1 },
        ],
        armour: "Light",
      }),
    });
    const c = uc(container);
    expect(kitText(c)).toBe("Longbow (rng 2–6) Short Sword Light");
    expect([...c.querySelectorAll(".ros-uc-wdesc p")].map((p) => p.textContent)).toEqual([
      "A Longbow shoots far.",
      "A last resort.",
    ]);
  });

  it("a druid's shapeshift forms", async () => {
    const { push, ctrl } = await mount({ campaignMapId: 200 });
    push({ selected: knight({ type: "druids", kind: "melee", shapeshift: ["bear", "greateagle", "wyrm"] }) });
    expect(btn("Guardian Bear").querySelector("img").getAttribute("src")).toContain("sprites/stand/bear.png");
    fireEvent.click(btn("Great Eagle"));
    expect(ctrl.shapeshift).toHaveBeenCalledWith("greateagle");
    fireEvent.click(btn("wyrm")); // unknown form: shown by its key
    expect(ctrl.shapeshift).toHaveBeenLastCalledWith("wyrm");
  });

  it("over water or cliffs the shapeshift forms are greyed out, with the reason", async () => {
    const { push } = await mount({ campaignMapId: 200 });
    push({
      selected: knight({
        type: "greateagle",
        kind: "cavalry",
        shapeshift: ["druids", "stag", "bear"],
        shapeshiftBlocked: true,
      }),
    });
    expect(btn("Druid").disabled).toBe(true);
    expect(btn("Guardian Bear").getAttribute("title")).toBe("Can't shapeshift over water or cliffs");
  });

  it("aimed skills (the shared skill row) arm through the engine", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    push({
      selected: knight({ type: "wizards", kind: "ranged" }),
      aimSkills: [{ id: "fireball", name: "Fireball", icon: "skill_fireball", min: 2, max: 4, desc: "Burn" }],
      aimActive: "fireball",
    });
    const b = container.querySelector(".ros-aim-skill");
    expect(b.className).toContain(" on");
    fireEvent.click(b);
    expect(ctrl.aimSkill).toHaveBeenCalledWith("fireball");
  });

  it("a priest's prayers: Heal note, Shield, Retribution (hover previews its radius)", async () => {
    const { push, ctrl, container } = await mount({ campaignMapId: 200 });
    push({ selected: knight({ type: "priests", kind: "melee", retribution: true, ability: "Prayer" }) });
    const p = uc(container).querySelector(".ros-prayer");
    expect(p.textContent).toContain("Heal — tap an adjacent wounded ally for +20 HP");
    expect(uc(container).textContent).not.toContain("✦ Prayer"); // the prayer row replaces the ability line
    fireEvent.click(btn(/Shield —/));
    expect(ctrl.invokeShield).toHaveBeenCalledTimes(1);
    const r = btn(/Retribution —/);
    fireEvent.mouseEnter(r);
    expect(ctrl.setRetribPreview).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(r);
    expect(ctrl.setRetribPreview).toHaveBeenLastCalledWith(false);
    fireEvent.click(r);
    expect(ctrl.invokeRetribution).toHaveBeenCalledTimes(1);
  });

  it("formation cover: with adjacent allies, and alone", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ selected: knight({ type: "pikemen", kind: "spear", formation: true, formationAllies: 3 }) });
    let f = [...uc(container).querySelectorAll(".ros-charge")].pop();
    expect(f.textContent).toContain("Formation: 30% damage reduction — adjacent formation allies: 3");
    push({ selected: knight({ type: "pikemen", kind: "spear", formation: true, formationAllies: 0 }) });
    f = [...uc(container).querySelectorAll(".ros-charge")].pop();
    expect(f.textContent).toContain("0% damage reduction — stand beside formation allies for +10% each");
  });
});

describe("unit card: the phone details sheet (ⓘ)", () => {
  const k = (id, over = {}) => ({
    id,
    type: "knights",
    name: "Knights",
    kind: "cavalry",
    hp: 80,
    move: 8,
    range: 1,
    ...over,
  });

  it("ⓘ opens the full card over the board and ✕ / the scrim / another unit / an armed skill close it", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    expect(qBtn("Show details")).toBeNull(); // nothing to detail
    push({ selected: k(1) });
    expect(container.querySelector(".ros-uc-slot .ros-unitcard")).toBeTruthy();
    fireEvent.click(btn("Show details"));
    expect(uc(container).className).toBe("ros-unitcard open");
    expect(btn("Hide details").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(btn("Hide details"));
    expect(uc(container).className).toBe("ros-unitcard");
    fireEvent.click(btn("Show details"));
    fireEvent.click(container.querySelector(".ros-uc-scrim"));
    expect(container.querySelector(".ros-uc-scrim")).toBeNull();
    fireEvent.click(btn("Show details"));
    push({ selected: k(2) }); // another unit
    expect(uc(container).className).toBe("ros-unitcard");
    fireEvent.click(btn("Show details"));
    push({ selected: k(2), aimActive: "fireball" }); // a skill armed: aim on the board
    expect(uc(container).className).toBe("ros-unitcard");
  });

  it("an inspected unit and a terrain tile get ⓘ too", async () => {
    const { push } = await mount({ campaignMapId: 200 });
    push({ inspect: { ...k(7), foe: true } });
    expect(btn("Show details")).toBeTruthy();
    push({ tileInfo: { name: "Forest", passable: true, move: 2, def: 20, heal: 0 } });
    expect(btn("Show details")).toBeTruthy();
  });
});

describe("unit card: inspecting another unit", () => {
  const foe = (over = {}) => ({
    type: "swordsmen",
    name: "Swordsmen",
    kind: "melee",
    hp: 60,
    move: 4,
    atk: 30,
    range: 1,
    minRange: 1,
    foe: true,
    ...over,
  });

  it("an enemy: its faction colour, stats, kit and the orange-squares tip", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({
      inspect: foe({ faction: "Carrone Army", factionColor: "rgb(200, 0, 0)", weapon: "Sword", armour: "Medium" }),
    });
    const c = uc(container);
    expect(c.className).toBe("ros-unitcard");
    expect(c.querySelector(".ros-uc-name").textContent).toBe("Swordsmen");
    expect(c.querySelector(".ros-uc-role").textContent).toBe("Carrone Army · Infantry");
    expect(c.querySelector(".ros-faction-dot").style.background).toBe("rgb(200, 0, 0)");
    expect([...c.querySelectorAll(".ros-uc-stat")].map((x) => x.textContent)).toEqual([
      "HP60",
      "MOV4",
      "ATK30",
      "RNG1",
    ]);
    expect(c.querySelector(".ros-hpbar i").style.width).toBe("60%");
    expect(kitText(c)).toBe("Sword Medium");
    expect(c.querySelector(".ros-charge").textContent).toContain("Line infantry");
  });

  it("an unnamed enemy, a ranged kit, statuses and the generic foe tip", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({
      inspect: foe({
        type: "q",
        kind: "q",
        atk: null,
        range: 4,
        minRange: 2,
        weapon: "Sling",
        hero: true,
        statuses: [{ name: "Slowed", desc: "Moves less", icon: "status_slow" }],
      }),
    });
    const c = uc(container);
    expect(c.querySelector(".ros-uc-name").textContent).toBe("Swordsmen ★");
    expect(c.querySelector(".ros-uc-role").textContent).toBe("Enemy · q");
    expect(c.textContent).not.toContain("ATK");
    expect(kitText(c)).toBe("Sling (rng 2–4)");
    expect(c.querySelector(".ros-uc-status-row").textContent).toBe("Slowed — Moves less");
    expect(c.querySelector(".ros-charge").textContent).toBe("Orange squares show where this foe can move & strike.");
  });

  it("an allied unit, and your own (ready / spent)", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ inspect: foe({ foe: false, ally: true, faction: "Rebel Army", factionColor: "blue" }) });
    expect(uc(container).querySelector(".ros-uc-role").textContent).toBe("Rebel Army · ally · Infantry");
    push({ inspect: foe({ foe: false, ally: true }) });
    expect(uc(container).querySelector(".ros-uc-role").textContent).toBe("Allied army · ally · Infantry");
    push({ inspect: foe({ foe: false, acted: true, kind: "q", type: "q", armour: "Light" }) });
    expect(uc(container).querySelector(".ros-uc-role").textContent).toBe("Your unit · spent · q");
    expect(kitText(uc(container))).toBe("Light");
    expect(uc(container).querySelector(".ros-charge").textContent).toBe(
      "Yellow squares show where this unit can move & strike.",
    );
    push({ inspect: foe({ foe: false, statuses: [] }) });
    expect(uc(container).querySelector(".ros-uc-role").textContent).toBe("Your unit · Infantry");
    expect(uc(container).querySelector(".ros-uc-status")).toBeNull();
  });

  it("abilities (icon or ✦) and formation cover", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ inspect: foe({ ability: "Fear — adjacent foes balk" }) });
    expect(uc(container).querySelector(".ros-charge img").getAttribute("src")).toBe(BASE + "hud/skill_fear.png");
    push({ inspect: foe({ ability: "Strange Gift" }) });
    expect(uc(container).querySelector(".ros-charge").textContent).toBe("✦ Strange Gift");
    push({ inspect: foe({ formation: true, formationAllies: 2 }) });
    let f = [...uc(container).querySelectorAll(".ros-charge")].pop();
    expect(f.textContent).toContain("20% damage reduction — adjacent formation allies: 2");
    push({ inspect: foe({ formation: true, formationAllies: 0 }) });
    f = [...uc(container).querySelectorAll(".ros-charge")].pop();
    expect(f.textContent).toContain("none adjacent yet");
  });
});

describe("unit card: terrain", () => {
  const tile = (over = {}) => ({ name: "Plains", passable: true, move: 1, def: 0, heal: 0, ...over });

  it("open ground", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ tileInfo: tile() });
    const c = uc(container);
    expect(c.querySelector(".ros-uc-name").textContent).toBe("Plains");
    expect(c.querySelector(".ros-uc-role").textContent).toBe("Terrain");
    expect([...c.querySelectorAll(".ros-uc-stat")].map((x) => x.textContent)).toEqual(["MOVE1", "DEF+0%"]);
    expect(c.querySelector(".ros-charge").textContent).toBe("Open ground.");
  });

  it("the original's per-class move costs, negative cover and engine-only ground", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({
      tileInfo: tile({
        name: "Hills",
        def: 30,
        costs: { skirmish: 4, formation: 4, cavalry: 8, engine: null },
        blocksEngine: true,
      }),
    });
    let c = uc(container);
    expect([...c.querySelectorAll(".ros-uc-stat")].map((x) => x.textContent)).toEqual(["DEF+30%"]); // no single MOVE
    expect(c.querySelector(".ros-tile-costs").textContent).toBe(
      "Move cost: Skirmishers 4 · Formations 4 · Cavalry 8 · War engines ✕",
    );
    expect(c.querySelector(".ros-tile-costs .no").textContent).toContain("War engines");
    expect(c.querySelector(".ros-charge").textContent).toBe(
      "War engines cannot enter. Defensive terrain — units here take less damage.",
    );
    push({
      tileInfo: tile({
        name: "Shallow water",
        def: -20,
        costs: { skirmish: 2, formation: 3, cavalry: 3, engine: null },
        blocksEngine: true,
      }),
    });
    c = uc(container);
    expect([...c.querySelectorAll(".ros-uc-stat")].map((x) => x.textContent)).toEqual(["DEF−20%"]);
    expect(c.querySelector(".ros-charge").textContent).toBe(
      "War engines cannot enter. Exposed — units here take more damage.",
    );
    push({
      tileInfo: tile({
        name: "Fountain",
        heal: 10,
        def: 10,
        costs: { skirmish: 1, formation: 1, cavalry: 1, engine: null },
        blocksEngine: true,
      }),
    });
    expect(uc(container).querySelector(".ros-charge").textContent).toBe(
      "Restores 10 HP to a unit that starts its turn here. War engines cannot enter.",
    );
  });

  it("impassable, foot-only, healing and defensive tiles", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ tileInfo: tile({ name: "Cliff", passable: false, def: 0 }) });
    let c = uc(container);
    expect(c.querySelector(".ros-uc-role").textContent).toBe("Impassable");
    expect([...c.querySelectorAll(".ros-uc-stat")].map((x) => x.textContent)).toEqual(["DEF+0%", "—blocked"]);
    expect(c.querySelector(".ros-charge").textContent).toBe("No unit may cross this terrain.");
    push({ tileInfo: tile({ blocksMounted: true, def: 20 }) });
    expect(uc(container).querySelector(".ros-charge").textContent).toBe(
      "Foot only — cavalry & war engines cannot enter. Defensive terrain — units here take less damage.",
    );
    push({ tileInfo: tile({ heal: 20, def: 30 }) });
    c = uc(container);
    expect([...c.querySelectorAll(".ros-uc-stat")].map((x) => x.textContent)).toContain("HEAL+20");
    expect(c.querySelector(".ros-charge").textContent).toBe("Restores 20 HP to a unit that starts its turn here.");
    push({ tileInfo: tile({ def: 25 }) });
    expect(uc(container).querySelector(".ros-charge").textContent).toBe(
      "Defensive terrain — units here take less damage.",
    );
  });

  it("quicksand rounds left", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ tileInfo: tile({ quicksand: { turns: 2 } }) });
    const q = uc(container).querySelector(".ros-qs-line");
    expect(q.textContent).toContain("Quicksand · 2 round(s) left");
    expect(q.textContent).toContain("takes 5 damage");
  });

  it("structures: intact, damaged, destroyed", async () => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push({ tileInfo: tile({ structure: { material: "Stone", stage: "Intact", hp: 100, stagesLeft: 3 } }) });
    let s = uc(container).querySelector(".ros-struct-line");
    expect(s.querySelector("span").textContent).toBe("Stone structure · Intact");
    expect(s.querySelector(".ros-struct-hp").textContent).toBe(" 100%");
    expect(s.querySelector(".ros-struct-hp i").style.width).toBe("100%");
    expect(s.querySelector("small").textContent).toContain("The first damaging hit");
    push({ tileInfo: tile({ structure: { material: "Wood", stage: "Damaged", hp: 40, stagesLeft: 2 } }) });
    s = uc(container).querySelector(".ros-struct-line");
    expect(s.querySelector("small").textContent).toBe("Stages left until it is destroyed: 2.");
    push({ tileInfo: tile({ structure: { material: "Wood", stage: "Destroyed", hp: 0, stagesLeft: 0 } }) });
    s = uc(container).querySelector(".ros-struct-line");
    expect(s.querySelector(".ros-struct-hp")).toBeNull();
    expect(s.querySelector("small").textContent).toBe("Craftsmen can rebuild it one stage at a time.");
  });
});

describe("unit card: nothing selected", () => {
  it.each([
    [{ marching: true }, "⚑ The column advances on your order…"],
    [
      { orderMode: "march" },
      "⚑ Tap a destination — your whole un-moved line marches there and engages any enemy in reach.",
    ],
    [{ phase: "player" }, "Select a unit — or tap terrain to read its effect"],
    [{ phase: "ally" }, "Your allies are advancing…"],
    [{ phase: "enemy" }, "Enemy warband is moving…"],
    [{ phase: "victory" }, "Victory — the field is yours."],
    [{ phase: "defeat" }, "The battle is lost."],
    [{ phase: "intro" }, ""],
  ])("%o → %s", async (st, text) => {
    const { push, container } = await mount({ campaignMapId: 200 });
    push(st);
    expect(uc(container).className).toBe("ros-unitcard empty");
    expect(uc(container).querySelector(".ros-uc-empty").textContent).toBe(text);
  });
});
