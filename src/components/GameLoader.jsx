import "./GameLoader.css";

// Shown while a game's assets/data load. Used by ReignShell and StoryGame.
export default function GameLoader({ label = "Loading…", emblem = "⚔" }) {
  return (
    <div className="game-loader" role="status" aria-live="polite">
      <div className="game-loader-emblem">
        <span className="game-loader-ring" />
        {emblem && <span className="game-loader-swords">{emblem}</span>}
      </div>
      <p className="game-loader-label">{label}</p>
    </div>
  );
}
