"use client";

export function NotesButton({
  pressed,
  onPressedChange,
}: {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPressedChange(!pressed)}
      aria-pressed={pressed}
      aria-label={pressed ? "Hide notes" : "Show notes"}
      className={`min-h-9 border px-2.5 text-[11px] font-semibold transition-colors ${
        pressed
          ? "border-ink bg-ink text-paper"
          : "border-rule bg-panel text-ink-soft hover:bg-paper hover:text-ink"
      }`}
    >
      Notes
    </button>
  );
}
