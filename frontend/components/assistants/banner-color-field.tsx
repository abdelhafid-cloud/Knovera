"use client";

const PRESETS = ["#3B82F6", "#2563EB", "#0EA5E9", "#1D4ED8", "#6366F1", "#0F766E"];

export function BannerColorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((color) => (
          <button
            key={color}
            type="button"
            title={color}
            onClick={() => onChange(color)}
            className="size-7 rounded-full border-2"
            style={{
              backgroundColor: color,
              borderColor: value.toUpperCase() === color ? "var(--foreground)" : "transparent",
            }}
          />
        ))}
        <label className="ml-1 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="color"
            value={/^#[0-9A-Fa-f]{6}$/.test(value) ? value : "#3B82F6"}
            onChange={(e) => onChange(e.target.value.toUpperCase())}
            className="h-8 w-10 cursor-pointer rounded border border-border bg-transparent"
          />
          {value}
        </label>
      </div>
      <div className="rounded-lg px-3 py-2 text-xs font-medium text-white" style={{ backgroundColor: value }}>
        Aperçu du bandeau
      </div>
    </div>
  );
}
