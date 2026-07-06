import { parseCsv } from './csv';
import { HoursMapping } from './types';

export interface ImportPreviewEvent {
  key: string;
  subject: string;
  datetimeLabel: string;
  hours: number;
  projectId: string | null;
  auto: boolean;
}

export interface ImportResult {
  assigned: ImportPreviewEvent[];
  unassigned: ImportPreviewEvent[];
}

const HEADER_ALIASES: Record<'subject' | 'startDate' | 'startTime' | 'endDate' | 'endTime', string[]> = {
  subject: ['件名', 'subject'],
  startDate: ['開始日', 'start date'],
  startTime: ['開始時刻', 'start time'],
  endDate: ['終了日', 'end date'],
  endTime: ['終了時刻', 'end time'],
};

const ROUND_UNIT = 0.25;

function findColumnIndex(header: string[], aliases: string[]): number {
  return header.findIndex((h) => aliases.includes(h.trim().toLowerCase()));
}

function parseDatePart(value: string): { y: number; m: number; d: number } | undefined {
  const iso = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    return { y: Number(iso[1]), m: Number(iso[2]), d: Number(iso[3]) };
  }
  // Outlookの英語ロケール既定エクスポートは M/D/YYYY
  const us = value.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (us) {
    return { y: Number(us[3]), m: Number(us[1]), d: Number(us[2]) };
  }
  return undefined;
}

function parseTimePart(value: string): { h: number; min: number; sec: number } | undefined {
  const match = value
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?$/);
  if (!match) return undefined;
  let h = Number(match[1]);
  const min = Number(match[2]);
  const sec = match[3] ? Number(match[3]) : 0;
  const meridiem = match[4]?.toUpperCase();
  if (meridiem === 'AM' && h === 12) h = 0;
  if (meridiem === 'PM' && h !== 12) h += 12;
  return { h, min, sec };
}

function parseDateTime(dateStr: string, timeStr: string): Date | undefined {
  const date = parseDatePart(dateStr);
  const time = parseTimePart(timeStr);
  if (!date || !time) return undefined;
  return new Date(date.y, date.m - 1, date.d, time.h, time.min, time.sec);
}

function formatDateTimeLabel(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function roundHours(rawHours: number): number {
  return Number((Math.round(rawHours / ROUND_UNIT) * ROUND_UNIT).toFixed(2));
}

function matchRule(subject: string, mapping: HoursMapping): string | null {
  const target = mapping.caseSensitive ? subject : subject.toLowerCase();
  for (const rule of mapping.rules) {
    const keyword = mapping.caseSensitive ? rule.keyword : rule.keyword.toLowerCase();
    if (target.includes(keyword)) {
      return rule.projectId;
    }
  }
  return null;
}

export function parseOutlookCsv(csvText: string, mapping: HoursMapping): ImportResult {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    throw new Error('CSVにイベントデータが含まれていません。');
  }
  const header = rows[0];
  const columns = {
    subject: findColumnIndex(header, HEADER_ALIASES.subject),
    startDate: findColumnIndex(header, HEADER_ALIASES.startDate),
    startTime: findColumnIndex(header, HEADER_ALIASES.startTime),
    endDate: findColumnIndex(header, HEADER_ALIASES.endDate),
    endTime: findColumnIndex(header, HEADER_ALIASES.endTime),
  };
  if (Object.values(columns).some((idx) => idx === -1)) {
    throw new Error('CSVのヘッダー（件名/開始日/開始時刻/終了日/終了時刻）を認識できませんでした。');
  }

  const assigned: ImportPreviewEvent[] = [];
  const unassigned: ImportPreviewEvent[] = [];

  rows.slice(1).forEach((row, index) => {
    const subject = (row[columns.subject] ?? '').trim();
    if (!subject) return;
    const start = parseDateTime(row[columns.startDate] ?? '', row[columns.startTime] ?? '');
    const end = parseDateTime(row[columns.endDate] ?? '', row[columns.endTime] ?? '');
    if (!start || !end) return;

    const rawHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    if (rawHours <= 0) return;

    const projectId = matchRule(subject, mapping);
    const event: ImportPreviewEvent = {
      key: `evt-${index}`,
      subject,
      datetimeLabel: formatDateTimeLabel(start),
      hours: roundHours(rawHours),
      projectId,
      auto: projectId !== null,
    };
    if (projectId) {
      assigned.push(event);
    } else {
      unassigned.push(event);
    }
  });

  return { assigned, unassigned };
}
