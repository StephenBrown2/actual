import * as d from 'date-fns';

import { RSchedule } from '#server/util/rschedule';
import { parseDate } from '#shared/months';
import {
  getDateWithSkippedWeekend,
  recurConfigToRSchedule,
} from '#shared/schedules';
import { integerToAmount } from '#shared/util';
import type { AccountEntity, PayeeEntity, ScheduleEntity } from '#types/models';
import type { RecurConfig } from '#types/models/schedule';

const WEEKDAYS = 'MO,TU,WE,TH,FR';

function formatDate(yyyymmdd: string): string {
  return yyyymmdd.replace(/-/g, '');
}

function formatDtstamp(): string {
  const now = new Date();
  return (
    now.getUTCFullYear().toString() +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0') +
    'T' +
    String(now.getUTCHours()).padStart(2, '0') +
    String(now.getUTCMinutes()).padStart(2, '0') +
    String(now.getUTCSeconds()).padStart(2, '0') +
    'Z'
  );
}

function endPart(config: RecurConfig): string {
  if (config.endMode === 'after_n_occurrences') {
    return `;COUNT=${config.endOccurrences ?? 1}`;
  }
  if (config.endMode === 'on_date' && config.endDate) {
    return `;UNTIL=${formatDate(config.endDate)}`;
  }
  return '';
}

function dateToYMD(date: Date): string {
  return (
    date.getFullYear().toString() +
    String(date.getMonth() + 1).padStart(2, '0') +
    String(date.getDate()).padStart(2, '0')
  );
}

// Expand all occurrences for a config, applying skipWeekend manually.
// Used as fallback when no clean RRULE exists.
function expandOccurrences(config: RecurConfig, years = 3): string[] {
  const ruleOptions = recurConfigToRSchedule(config);
  const start = parseDate(config.start);
  const end = d.addYears(start, years);
  const seen = new Set<string>();

  for (const opts of ruleOptions) {
    const schedule = new RSchedule({ rrules: [opts as never] });
    for (const occ of schedule.occurrences({ start, end }).toArray()) {
      let date = occ.date;
      if (config.skipWeekend && config.weekendSolveMode) {
        date = getDateWithSkippedWeekend(date, config.weekendSolveMode);
      }
      seen.add(dateToYMD(date));
    }
  }

  return Array.from(seen).sort();
}

type VEventSpec = {
  // Appended to schedule.id before "@actual-budget" to form UID
  uidSuffix: string;
  dtstart: string; // YYYYMMDD
  rrule: string | null;
  // Non-null only when rrule is null (expansion fallback)
  expandedDates: string[] | null;
};

function monthDayBySetPos(
  day: number,
  solveMode: 'before' | 'after',
): { byMonthDay: number[]; bySetPos: -1 | 1 } {
  if (solveMode === 'before') {
    // Sat→Fri requires 1 day back, Sun→Fri requires 2 days back.
    // Range {D-4..D} and pick last weekday in that range.
    return {
      byMonthDay: [day - 4, day - 3, day - 2, day - 1, day].filter(n => n >= 1),
      bySetPos: -1,
    };
  }
  // after: Mon after Sat (1 day forward), Mon after Sun (1 day forward).
  return {
    byMonthDay: [day, day + 1, day + 2].filter(n => n <= 28),
    bySetPos: 1,
  };
}

function buildVEvents(config: RecurConfig): VEventSpec[] {
  const end = endPart(config);
  const interval =
    config.interval && config.interval > 1
      ? `;INTERVAL=${config.interval}`
      : '';
  const dtstart = formatDate(config.start);
  const startDay = parseInt(config.start.split('-')[2], 10);
  const startMonth = parseInt(config.start.split('-')[1], 10);
  const startDate = parseDate(config.start);

  switch (config.frequency) {
    case 'daily': {
      if (!config.skipWeekend) {
        return [
          {
            uidSuffix: '',
            dtstart,
            rrule: `FREQ=DAILY${interval}${end}`,
            expandedDates: null,
          },
        ];
      }
      // interval=1: "every weekday" is a valid approximation
      if (!config.interval || config.interval === 1) {
        return [
          {
            uidSuffix: '',
            dtstart,
            rrule: `FREQ=DAILY;BYDAY=${WEEKDAYS}${end}`,
            expandedDates: null,
          },
        ];
      }
      // interval>1 + skipWeekend: no clean RRULE, expand
      return [
        {
          uidSuffix: '',
          dtstart,
          rrule: null,
          expandedDates: expandOccurrences(config),
        },
      ];
    }

    case 'weekly': {
      // Weekly never hits different days of week, so skipWeekend is a no-op
      // unless the start date itself is a weekend.
      let effectiveDtstart = dtstart;
      if (config.skipWeekend && d.isWeekend(startDate)) {
        const adjusted = getDateWithSkippedWeekend(
          startDate,
          config.weekendSolveMode ?? 'after',
        );
        effectiveDtstart = dateToYMD(adjusted);
      }
      return [
        {
          uidSuffix: '',
          dtstart: effectiveDtstart,
          rrule: `FREQ=WEEKLY${interval}${end}`,
          expandedDates: null,
        },
      ];
    }

    case 'monthly': {
      const patterns = config.patterns ?? [];
      const dayPatterns = patterns.filter(p => p.type === 'day');
      const weekdayPatterns = patterns.filter(p => p.type !== 'day');

      // No patterns: recurs on same day-of-month as start date
      if (patterns.length === 0) {
        if (!config.skipWeekend) {
          return [
            {
              uidSuffix: '',
              dtstart,
              rrule: `FREQ=MONTHLY${interval};BYMONTHDAY=${startDay}${end}`,
              expandedDates: null,
            },
          ];
        }
        const { byMonthDay, bySetPos } = monthDayBySetPos(
          startDay,
          config.weekendSolveMode ?? 'after',
        );
        return [
          {
            uidSuffix: '',
            dtstart,
            rrule: `FREQ=MONTHLY${interval};BYDAY=${WEEKDAYS};BYMONTHDAY=${byMonthDay.join(',')};BYSETPOS=${bySetPos}${end}`,
            expandedDates: null,
          },
        ];
      }

      // byDayOfMonth only
      if (dayPatterns.length > 0 && weekdayPatterns.length === 0) {
        if (!config.skipWeekend) {
          return [
            {
              uidSuffix: '',
              dtstart,
              rrule: `FREQ=MONTHLY${interval};BYMONTHDAY=${dayPatterns.map(p => p.value).join(',')}${end}`,
              expandedDates: null,
            },
          ];
        }
        // One VEVENT per day using BYSETPOS
        return dayPatterns.map(p => {
          const { byMonthDay, bySetPos } = monthDayBySetPos(
            p.value,
            config.weekendSolveMode ?? 'after',
          );
          return {
            uidSuffix: dayPatterns.length > 1 ? `-day${p.value}` : '',
            dtstart,
            rrule: `FREQ=MONTHLY${interval};BYDAY=${WEEKDAYS};BYMONTHDAY=${byMonthDay.join(',')};BYSETPOS=${bySetPos}${end}`,
            expandedDates: null,
          };
        });
      }

      // byDayOfWeek only (weekday positions like "1st Monday", "last Friday")
      // These never land on weekends, so skipWeekend is a no-op.
      if (weekdayPatterns.length > 0 && dayPatterns.length === 0) {
        const byday = weekdayPatterns.map(p => `${p.value}${p.type}`).join(',');
        return [
          {
            uidSuffix: '',
            dtstart,
            rrule: `FREQ=MONTHLY${interval};BYDAY=${byday}${end}`,
            expandedDates: null,
          },
        ];
      }

      // Mixed: split into 2 VEVENTs
      const events: VEventSpec[] = [];

      // Part 1: byDayOfMonth
      if (!config.skipWeekend) {
        events.push({
          uidSuffix: '-part1',
          dtstart,
          rrule: `FREQ=MONTHLY${interval};BYMONTHDAY=${dayPatterns.map(p => p.value).join(',')}${end}`,
          expandedDates: null,
        });
      } else {
        events.push({
          uidSuffix: '-part1',
          dtstart,
          rrule: null,
          expandedDates: expandOccurrences(
            { ...config, patterns: dayPatterns },
            3,
          ),
        });
      }

      // Part 2: byDayOfWeek (never needs skipWeekend)
      const byday = weekdayPatterns.map(p => `${p.value}${p.type}`).join(',');
      events.push({
        uidSuffix: '-part2',
        dtstart,
        rrule: `FREQ=MONTHLY${interval};BYDAY=${byday}${end}`,
        expandedDates: null,
      });

      return events;
    }

    case 'yearly': {
      if (!config.skipWeekend) {
        return [
          {
            uidSuffix: '',
            dtstart,
            rrule: `FREQ=YEARLY${interval}${end}`,
            expandedDates: null,
          },
        ];
      }
      const { byMonthDay, bySetPos } = monthDayBySetPos(
        startDay,
        config.weekendSolveMode ?? 'after',
      );
      return [
        {
          uidSuffix: '',
          dtstart,
          rrule: `FREQ=YEARLY${interval};BYMONTH=${startMonth};BYDAY=${WEEKDAYS};BYMONTHDAY=${byMonthDay.join(',')};BYSETPOS=${bySetPos}${end}`,
          expandedDates: null,
        },
      ];
    }

    default:
      return [];
  }
}

// RFC 5545 line folding: max 75 octets per line, continuation with CRLF + space
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let pos = 75;
  while (pos < line.length) {
    parts.push(' ' + line.slice(pos, pos + 74));
    pos += 74;
  }
  return parts.join('\r\n');
}

function formatAmount(amount: ScheduleEntity['_amount']): string {
  if (typeof amount === 'number') {
    const abs = integerToAmount(Math.abs(amount));
    return `${amount < 0 ? '-' : '+'}${abs.toFixed(2)}`;
  }
  // range (isbetween)
  const a = integerToAmount(Math.abs(amount.num1)).toFixed(2);
  const b = integerToAmount(Math.abs(amount.num2)).toFixed(2);
  return `${a}–${b}`;
}

export function schedulesToIcal(
  schedules: ScheduleEntity[],
  payees: Record<string, PayeeEntity>,
  accounts: Record<string, AccountEntity>,
): string {
  const dtstamp = formatDtstamp();

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Actual Budget//Schedule Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  function pushVEvent(
    uid: string,
    dtstart: string,
    rruleLine: string | null,
    expandedDates: string[] | null,
    summary: string,
    description: string,
  ) {
    if (rruleLine) {
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtstamp}`);
      lines.push(`DTSTART;VALUE=DATE:${dtstart}`);
      lines.push(foldLine(`RRULE:${rruleLine}`));
      lines.push(foldLine(`SUMMARY:${summary}`));
      if (description) lines.push(foldLine(`DESCRIPTION:${description}`));
      lines.push('END:VEVENT');
    } else if (expandedDates && expandedDates.length > 0) {
      for (const date of expandedDates) {
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${uid}-${date}`);
        lines.push(`DTSTAMP:${dtstamp}`);
        lines.push(`DTSTART;VALUE=DATE:${date}`);
        lines.push(foldLine(`SUMMARY:${summary}`));
        if (description) lines.push(foldLine(`DESCRIPTION:${description}`));
        lines.push('END:VEVENT');
      }
    }
  }

  for (const schedule of schedules) {
    if (schedule.completed) continue;

    const payeeName = schedule._payee
      ? (payees[schedule._payee]?.name ?? null)
      : null;
    const accountName = schedule._account
      ? (accounts[schedule._account]?.name ?? null)
      : null;
    const summary = schedule.name ?? payeeName ?? 'Schedule';
    const amountStr =
      schedule._amount != null ? formatAmount(schedule._amount) : '';
    const description = [accountName, amountStr].filter(Boolean).join(' — ');

    const dateCond = schedule._date;

    // One-time schedule
    if (typeof dateCond === 'string') {
      pushVEvent(
        `${schedule.id}@actual-budget`,
        formatDate(dateCond),
        null,
        [formatDate(dateCond)],
        summary,
        description,
      );
      continue;
    }

    // Recurring
    for (const spec of buildVEvents(dateCond)) {
      pushVEvent(
        `${schedule.id}${spec.uidSuffix}@actual-budget`,
        spec.dtstart,
        spec.rrule,
        spec.expandedDates,
        summary,
        description,
      );
    }
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
