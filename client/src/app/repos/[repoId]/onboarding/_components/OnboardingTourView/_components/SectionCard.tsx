import React from "react";
import { Icon, type IconName } from "@devdigest/ui";
import { s } from "../styles";

/** Card wrapper shared by all 5 tour sections: icon + title header, id used
 *  as the "ON THIS PAGE" anchor-nav scroll target. `tabIndex={-1}` lets the
 *  anchor nav move keyboard focus onto the section on activation. */
export function SectionCard({
  id,
  icon,
  title,
  children,
}: {
  id: string;
  icon: IconName;
  title: string;
  children: React.ReactNode;
}) {
  const I = Icon[icon];
  return (
    <section id={id} tabIndex={-1} style={s.card} aria-label={title}>
      <div style={s.cardHeader}>
        <span style={s.cardIcon} aria-hidden="true">
          <I size={14} />
        </span>
        <h2 style={s.cardTitle}>{title}</h2>
      </div>
      <div style={s.cardBody}>{children}</div>
    </section>
  );
}
