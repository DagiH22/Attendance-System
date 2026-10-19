import React from "react";

export interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
  maxWidthClass?: string;
}

export const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  className = "",
  maxWidthClass = "max-w-7xl",
}) => {
  return (
    <div className={`mx-auto w-full ${maxWidthClass} px-4 sm:px-6 lg:px-8 py-6 space-y-6 ${className}`}>
      {children}
    </div>
  );
};

export default PageLayout;
