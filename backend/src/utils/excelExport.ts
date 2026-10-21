import type { Response } from "express";

const sanitizeBaseName = (value: string, fallback: string) => {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\r\n\t]/g, " ")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return cleaned || fallback;
};

export const setExcelDownloadHeaders = (
  res: Response,
  baseName: string,
  fallbackBaseName = "export",
) => {
  const asciiBase = sanitizeBaseName(baseName, fallbackBaseName);
  const asciiFileName = `${asciiBase}.xlsx`;

  const utf8Base = (baseName || fallbackBaseName)
    .replace(/[\r\n\t]/g, " ")
    .trim()
    .slice(0, 120) || fallbackBaseName;
  const utf8FileName = `${utf8Base}.xlsx`;
  const encodedUtf8FileName = encodeURIComponent(utf8FileName);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodedUtf8FileName}`,
  );

  return asciiFileName;
};

export const formatAddisDateTime = (
  date: Date | string | null | undefined,
): string => {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(d);
};

export const formatAddisDate = (
  date: Date | string | null | undefined,
): string => {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Addis_Ababa",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(d);
};
