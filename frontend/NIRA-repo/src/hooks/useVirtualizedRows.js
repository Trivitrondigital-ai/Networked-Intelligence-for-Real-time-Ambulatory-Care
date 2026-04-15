import { useEffect, useMemo, useRef, useState } from "react";

export function useVirtualizedRows(
  items,
  {
    rowHeight = 140,
    viewportHeight = 560,
    overscan = 4,
    resetKey = ""
  } = {}
) {
  const viewportRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }

    setScrollTop(0);
  }, [resetKey]);

  const totalHeight = items.length * rowHeight;

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan
  );

  const virtualRows = useMemo(
    () =>
      items.slice(startIndex, endIndex).map((item, offset) => ({
        item,
        index: startIndex + offset
      })),
    [items, startIndex, endIndex]
  );

  function onScroll(event) {
    setScrollTop(event.currentTarget.scrollTop);
  }

  return {
    viewportRef,
    onScroll,
    totalHeight,
    virtualRows,
    viewportHeight,
    rowHeight
  };
}
