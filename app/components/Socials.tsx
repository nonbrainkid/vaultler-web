import { LINKS } from "@/lib/links";

/** Кнопки соцсетей. Без href → неактивная заглушка с пометкой soon. */
export default function Socials({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div className={"socials " + (size === "sm" ? "socials-sm" : "")}>
      {LINKS.map((l) =>
        l.href ? (
          <a
            key={l.key}
            className="btn btn-wood"
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {l.label}
          </a>
        ) : (
          <button
            key={l.key}
            className="btn btn-wood is-stub"
            disabled
            aria-disabled="true"
            title="link coming soon"
          >
            {l.label}
            <span className="stub-tag">{l.note}</span>
          </button>
        ),
      )}
    </div>
  );
}
