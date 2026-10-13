import { useCallback, useRef, useState } from "react";
import { useDismiss } from "./useDismiss.ts";

/** Open state for a dropdown anchored in `root`; closes on a click outside it or on Escape. */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close);
  return { open, setOpen, close, root };
}
