import * as React from "react";

import { cn } from "@/lib/utils";

interface MorphingTextProps {
  words: string[];
  className?: string;
  interval?: number;
  animationDuration?: number;
}

const MorphingText = React.forwardRef<HTMLSpanElement, MorphingTextProps>(
  ({ words, className, interval = 3000 }, ref) => {
    const [currentIndex, setCurrentIndex] = React.useState(0);

    React.useEffect(() => {
      const timer = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % words.length);
      }, interval);
      return () => clearInterval(timer);
    }, [words.length, interval]);

    return (
      <span ref={ref} className="relative inline-block">
        <span key={currentIndex} className={cn("inline-block", className)}>
          {words[currentIndex]}
        </span>
      </span>
    );
  },
);
MorphingText.displayName = "MorphingText";

export { MorphingText };
