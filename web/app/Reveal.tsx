"use client";

import { useEffect } from "react";

// Reveals every [data-reveal] element once, when it enters the viewport.
// Hiding is done in CSS only under html.js-reveal, so without JS (or with
// reduced motion) everything stays visible.
export default function Reveal() {
  useEffect(() => {
    const root = document.documentElement;
    const els = document.querySelectorAll<HTMLElement>("[data-reveal]");

    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      root.setAttribute("data-rv", "");
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((el) => io.observe(el));
    root.setAttribute("data-rv", "");
    return () => io.disconnect();
  }, []);

  return null;
}
