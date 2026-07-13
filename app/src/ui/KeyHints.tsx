import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { hueColor, theme } from "../theme.js";

/**
 * Renders a hint string ("/ query · ↑↓ move · s save") with the key cap
 * of every chunk in the bold accent color and the description dimmed —
 * so the available commands read at a glance instead of being one dim
 * line. Chunks are "key description"; the first token is the key.
 */
export function KeyHints({ hints }: { hints: string }) {
  const chunks = hints.split(" · ").filter(Boolean);
  return (
    <Text>
      {chunks.map((chunk, i) => {
        const space = chunk.indexOf(" ");
        const key = space === -1 ? chunk : chunk.slice(0, space);
        const label = space === -1 ? "" : chunk.slice(space + 1);
        return (
          <Text key={i}>
            {i > 0 ? <Text color={theme.rule}> · </Text> : null}
            <Text bold color={theme.accent}>
              {key}
            </Text>
            {label ? <Text dimColor> {label}</Text> : null}
          </Text>
        );
      })}
    </Text>
  );
}

/**
 * Animated rainbow text for the MAX-cap warning: each character cycles
 * through the hue wheel. Animates only on a real TTY (a piped one-frame
 * render gets a static warning color so CI output stays deterministic).
 */
export function RainbowText({ children }: { children: string }) {
  const animate = Boolean(process.stdout.isTTY);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const timer = setInterval(() => setOffset((o) => (o + 14) % 360), 90);
    return () => clearInterval(timer);
  }, [animate]);
  if (!animate) {
    return (
      <Text bold color={theme.danger}>
        {children}
      </Text>
    );
  }
  return (
    <Text bold>
      {Array.from(children).map((ch, i) => (
        <Text key={i} color={hueColor(offset + i * 16)}>
          {ch}
        </Text>
      ))}
    </Text>
  );
}
