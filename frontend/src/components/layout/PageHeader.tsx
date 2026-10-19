import React from "react";

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  children,
}) => {
  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-slate-200/80">
      <div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
          {title}
        </h1>
        {subtitle && (
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 mt-1">
            {subtitle}
          </p>
        )}
      </div>
      {children && (
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap self-start md:self-auto">
          {children}
        </div>
      )}
    </div>
  );
};

export default PageHeader;
