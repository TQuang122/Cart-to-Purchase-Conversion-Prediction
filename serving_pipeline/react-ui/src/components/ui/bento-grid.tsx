import * as React from "react";
import { cn } from "@/lib/utils";

interface BentoGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

const BentoGrid = React.forwardRef<HTMLDivElement, BentoGridProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "grid auto-rows-[minmax(180px,1fr)] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
BentoGrid.displayName = "BentoGrid";

interface BentoGridItemProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  span?: 1 | 2 | 3;
}

const BentoGridItem = React.forwardRef<HTMLDivElement, BentoGridItemProps>(
  ({ className, children, span = 1, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          span === 3 && "col-span-1 md:col-span-2 lg:col-span-3",
          span === 2 && "col-span-1 md:col-span-2",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
BentoGridItem.displayName = "BentoGridItem";

export { BentoGrid, BentoGridItem };
