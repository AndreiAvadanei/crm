export type TagView = { id: string; name: string; color: string };

export function TagBadge({ tag }: { tag: TagView }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${tag.color}18`, color: tag.color }}
    >
      {tag.name}
    </span>
  );
}

export function StageBadge({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}
