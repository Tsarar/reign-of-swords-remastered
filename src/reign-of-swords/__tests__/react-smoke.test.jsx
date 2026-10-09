import { it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HeraldryShield } from "../ui/HeraldryShield.jsx";

it("renders a React component (JSX + Testing Library work)", () => {
  const { container } = render(
    <HeraldryShield heraldry={{ bgColor: "gules", symbol: 35, symbolColor: "or", bgType: 0 }} size={40} />,
  );
  expect(container.firstChild).toBeTruthy();
});
