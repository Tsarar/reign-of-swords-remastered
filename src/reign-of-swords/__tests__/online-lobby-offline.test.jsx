// The Online Battles lobby on a build without accounts (a copy of the game outside the website): it says online
// battles are not available here and links to this episode's page on the website; hot-seat stays one click away.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../../auth/AuthContext.jsx", () => ({ useAuth: () => ({ enabled: false, user: null, profile: null }) }));
vi.mock("../online/net.js", () => ({ GAME_OF_EPISODE: { 1: "reign-of-swords", 2: "reign-of-swords-2" } }));
const { default: OnlineLobby, ONLINE_ON_WEB } = await import("../ui/online/OnlineLobby.jsx");

afterEach(() => cleanup());

describe("Online Battles without accounts", () => {
  it("points to the website's page for this episode, opening in a new tab", () => {
    for (const episode of [1, 2]) {
      render(<OnlineLobby episode={episode} levels={[]} onPlay={() => {}} onHotseat={() => {}} onBack={() => {}} />);
      expect(
        screen.getByText(/Online battles are not available on this build — play them on the website/),
      ).toBeTruthy();
      const link = screen.getByRole("link", { name: "Play online on the website" });
      expect(link.getAttribute("href")).toBe(ONLINE_ON_WEB[episode]);
      expect(link.getAttribute("target")).toBe("_blank");
      cleanup();
    }
    expect(ONLINE_ON_WEB[2]).toBe("https://dmytro-portfolio-website.vercel.app/games/reign-of-swords-2");
  });

  it("hot-seat is still there", () => {
    const onHotseat = vi.fn();
    render(<OnlineLobby episode={1} levels={[]} onPlay={() => {}} onHotseat={onHotseat} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Hot-seat/ }));
    expect(onHotseat).toHaveBeenCalled();
  });
});
