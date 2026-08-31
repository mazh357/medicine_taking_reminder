import type { FollowUpInput } from "./medicationAppApi";

export function localParts(value?: string): { date: string; time: string } {
  const source = value ? new Date(value) : new Date();
  const date = Number.isNaN(source.getTime()) ? new Date() : source;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

export function toScheduledAt(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const parsed = new Date(`${date}T${time}:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const parts = localParts(parsed.toISOString());
  if (parts.date !== date || parts.time !== time) return null;
  return parsed.toISOString();
}

export function validateFollowUpInput(input: FollowUpInput): string | null {
  const title = input.title.trim();
  if (!title || Array.from(title).length > 80 || /[\u0000-\u001f\u007f-\u009f]/u.test(title)) {
    return "请输入 1—80 个字符的标题。";
  }
  if (Number.isNaN(Date.parse(input.scheduledAt))) return "请选择有效的日期和时间。";
  if (Array.from(input.notes).length > 500) return "备注不能超过 500 个字符。";
  return null;
}
