// The Online Battles lobby (ui/online/OnlineLobby.jsx) for a signed-in player: the new battle's terms — the map's
// gold, one amount, or Custom (each side's points and Medals) — and who moves first reach createMatch as the server
// takes them; the hot-seat mode stays one click away. The network (online/net.js) and the account are stubs.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const created = [];
vi.mock("../../auth/AuthContext.jsx", () => ({
  useAuth: () => ({ enabled: true, user: { id: "me" }, profile: { display_name: "Brave Otter 007" } }),
}));
vi.mock("../online/net.js", () => ({
  GAME_OF_EPISODE: { 1: "reign-of-swords", 2: "reign-of-swords-2" },
  listLobbies: vi.fn(async () => ({ open: [], mine: [] })),
  followLobbies: vi.fn(async () => () => {}),
  leaderboard: vi.fn(async () => []),
  createMatch: vi.fn(async (args) => {
    created.push(args);
    return "m1";
  }),
  joinMatch: vi.fn(),
}));
const { default: OnlineLobby } = await import("../ui/online/OnlineLobby.jsx");

// two skirmish maps: one with equal gold where the host opens, one with uneven gold where the guest (East) opens
const LEVELS = [
  {
    group: "skirmish",
    mapId: 11,
    name: "Even Field",
    budget: 3000,
    groupOrder: [
      { gi: 0, side: "player" },
      { gi: 1, side: "enemy" },
    ],
  },
  {
    group: "skirmish",
    mapId: 12,
    name: "Uneven Field",
    budget: 2000,
    enemyBudget: 2600,
    groupOrder: [
      { gi: 1, side: "player" },
      { gi: 0, side: "enemy" },
    ],
  },
];
const setup = (onHotseat = () => {}) => {
  const onPlay = vi.fn();
  render(<OnlineLobby episode={1} levels={LEVELS} onPlay={onPlay} onHotseat={onHotseat} onBack={() => {}} />);
  return onPlay;
};
const pick = (id, value) => fireEvent.change(document.getElementById(id), { target: { value } });
const createBattle = () => fireEvent.click(screen.getByRole("button", { name: "Create battle" }));

afterEach(() => {
  cleanup();
  created.length = 0;
});

describe("online lobby — new battle terms", () => {
  it("defaults: the map's own gold for each side, a coin toss, no Medals override", async () => {
    const onPlay = setup();
    pick("ros-ol-map", "12");
    createBattle();
    await waitFor(() => expect(onPlay).toHaveBeenCalledWith("m1"));
    expect(created[0]).toMatchObject({ mapId: 12, budgets: [2000, 2600], medals: null, first: "coin" });
  });

  it("one amount for both, and 'map order' becomes the side that opens that map", async () => {
    setup();
    pick("ros-ol-map", "12");
    pick("ros-ol-budget", "5000");
    pick("ros-ol-first", "map");
    createBattle();
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ budgets: [5000, 5000], first: "guest" });
  });

  it("Custom: each side's points and Medals (empty = automatic); bad values block the button", async () => {
    setup();
    pick("ros-ol-budget", "custom");
    pick("ros-ol-points-0", "2500");
    pick("ros-ol-points-1", "4000");
    pick("ros-ol-medals-0", "3");
    pick("ros-ol-first", "guest");
    pick("ros-ol-medals-1", "99");
    expect(screen.getByRole("button", { name: "Create battle" }).disabled).toBe(true);
    pick("ros-ol-medals-1", "");
    createBattle();
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({ budgets: [2500, 4000], medals: [3, null], first: "guest" });
  });

  it("hot-seat is on the signed-in lobby too", () => {
    const onHotseat = vi.fn();
    setup(onHotseat);
    fireEvent.click(screen.getByRole("button", { name: /Hot-seat/ }));
    expect(onHotseat).toHaveBeenCalled();
  });
});
