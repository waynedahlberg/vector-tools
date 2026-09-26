"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import {
  appearanceLabel,
  applyAppearance,
  getAppearance,
  nextAppearance,
  setAppearance,
  subscribeAppearance,
  type Appearance,
} from "@/lib/appearance";

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** Cycles system → light → dark. The icon updates after mount so SSR matches. */
export function AppearanceToggle() {
  const [mode, setMode] = useState<Appearance>("system");

  useEffect(() => {
    const current = getAppearance();
    applyAppearance(current);
    setMode(current);
    return subscribeAppearance(() => setMode(getAppearance()));
  }, []);

  const Icon = ICONS[mode];
  return (
    <Tooltip content={appearanceLabel(mode)}>
      <Button variant="ghost" size="icon-sm" aria-label={appearanceLabel(mode)} onClick={() => setAppearance(nextAppearance(mode))}>
        <Icon />
      </Button>
    </Tooltip>
  );
}
