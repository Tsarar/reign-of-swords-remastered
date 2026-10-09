import { useState } from "react";
import { COLLECTIBLES, MERCHANT_PRICE, MILITIA_PRICE, MAX_HELD, GET_OPTIONS } from "../../data/shell-data.js";
import { tr } from "../../i18n/i18n.js";
import { UnitSprite, SvgIcon, ResIcon, CountPicker } from "./common.jsx";

// ---- The Merchant (strings 249/676; MenuScreen::handlePopUpEvent, popup 61 "Confirm Purchase"): a collectible costs
// THREE of one other kind — you choose which, a Medal pays too — and a Militiaman costs one Armor, one Weapons and one
// Lore. Any number at once, up to the 500 a kind may hold. Medals are only won from Major Victories, never bought.
export function MerchantShop({ spoils, militia = 0, onTrade, onRecruit, onBack }) {
  const [give, setGive] = useState(null),
    [get, setGet] = useState(null),
    [count, setCount] = useState(1);
  const recruit = get === "militiamen";
  const have = (id) => spoils[id] || 0;
  // how many this purchase can be: what the price allows, and the room left under the 500 a kind may hold
  const most = !get
    ? 0
    : recruit
      ? Math.min(...MILITIA_PRICE.map(have), MAX_HELD - militia)
      : give && give !== get
        ? Math.min(Math.floor(have(give) / MERCHANT_PRICE), MAX_HELD - have(get))
        : 0;
  const n = Math.max(1, Math.min(count, most));
  const canTrade = most > 0;
  const exchange = () => {
    if (!canTrade) return;
    if (recruit) onRecruit(n);
    else onTrade(give, get, n);
    setCount(1);
  };
  return (
    <div className="ros-screen ros-merchant">
      <div className="ros-screen-head">
        <h2>{tr("The Merchant")}</h2>
        <button className="btn-run" onClick={onBack}>
          ◂ {tr("Main Menu")}
        </button>
      </div>
      <p className="ros-screen-sub">
        {tr(
          "The Merchant trades your excess Spoils of War: a collectible for three of another kind, or a Militiaman for one Armor, one Weapons and one Lore. Medals can only be won from Major Victories.",
        )}
      </p>
      <div className="ros-mch">
        <div className="ros-mch-col">
          <div className="ros-mch-h">
            {tr("Give")} <i>×{MERCHANT_PRICE}</i>
          </div>
          {COLLECTIBLES.map((c) => (
            <button
              key={c.id}
              disabled={recruit || have(c.id) < MERCHANT_PRICE}
              className={"ros-mch-chip" + (give === c.id && !recruit ? " sel" : "")}
              onClick={() => setGive(c.id)}
            >
              <ResIcon id={c.id} size={26} /> <span className="ros-mch-name">{tr(c.id)}</span> <i>×{have(c.id)}</i>
            </button>
          ))}
        </div>
        <div className="ros-mch-mid">
          <SvgIcon name="trade" className="ros-mch-arrow" />
          {get ? (
            <span className="ros-mch-cost">
              {recruit
                ? tr("Each costs 1 Armor, 1 Weapons and 1 Lore")
                : give
                  ? tr("Each costs {n} {c}", { n: MERCHANT_PRICE, c: tr(give) })
                  : tr("Choose what to give")}
            </span>
          ) : null}
          <span className="ros-mch-count">
            {tr("Number")} <CountPicker value={n} max={Math.max(1, most)} onChange={setCount} />
          </span>
          <button className="btn btn-primary" disabled={!canTrade} onClick={exchange}>
            {tr("Exchange")}
          </button>
        </div>
        <div className="ros-mch-col">
          <div className="ros-mch-h">
            {tr("Get")} <i>×{n}</i>
          </div>
          {GET_OPTIONS.map((c) => (
            <button
              key={c.id}
              disabled={c.id === give && !c.unit}
              className={"ros-mch-chip" + (get === c.id ? " sel" : "") + (c.unit ? " unit" : "")}
              onClick={() => setGet(c.id)}
            >
              {c.unit ? (
                <span className="ros-mch-unit">
                  <UnitSprite unit="militiamen" size={30} framed={false} />
                </span>
              ) : (
                <ResIcon id={c.id} size={26} />
              )}{" "}
              <span className="ros-mch-name">{tr(c.label || c.id)}</span> <i>×{c.unit ? militia : have(c.id)}</i>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
